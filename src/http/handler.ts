import { getAccessPolicy, listUsers, setAccessPolicy, setRoles } from "../access/index.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../api-keys/index.js";
import { listAudit, audit } from "../audit/index.js";
import {
  BadRequestError,
  isBadRequestError,
  isForbiddenError,
  isMethodNotAllowedError,
  isUnauthorizedError,
  MethodNotAllowedError,
  requirePrincipal,
  requireRole,
  type AuthSessionSource,
} from "../auth/index.js";
import { isDataApiError, listResource, type DataApiRegistry } from "../data-api/index.js";
import type { Database } from "../database/types.js";
import { createLogger, logError } from "../logging/index.js";
import type { AppConfig } from "../runtime/types.js";
import { getHealthResponse } from "../runtime/health.js";
import {
  applyOverride,
  buildTimeTokens,
  validateDesignOverride,
  type DesignOverride,
  type DesignTokens,
} from "../design/index.js";
import {
  deleteSetting,
  getSetting,
  getSettingRecord,
  listSettings,
  setSetting,
} from "../settings/index.js";
import { getVersionResponse } from "../runtime/version.js";
import { readJsonBody } from "./json.js";

const logger = createLogger("http");
const PLATFORM_PREFIX = "/api/platform";
const NO_STORE = { "cache-control": "no-store" };

export type PlatformHandlerOptions = {
  appConfig: AppConfig;
  sessionSource: (request: Request) => AuthSessionSource;
  dataApi?: DataApiRegistry;
  getDatabase?: () => Promise<Database>;
  healthExtras?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Build-time `--pf-*` map from the host's generated design-tokens.css / design.md. */
  designTokens?: DesignTokens | (() => DesignTokens | Promise<DesignTokens>);
};

type RouteParams = Record<string, string>;

type RouteContext = {
  request: Request;
  url: URL;
  params: RouteParams;
  options: PlatformHandlerOptions;
};

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

type Route = {
  method: HttpMethod;
  pattern: string;
  handler: (ctx: RouteContext) => Promise<Response>;
};

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: { ...NO_STORE, ...extraHeaders },
  });
}

function notFound(): Response {
  return json({ error: "Not Found", code: "not_found" }, 404);
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

function matchPattern(pattern: string, path: string): RouteParams | null {
  const pSeg = pattern.split("/").filter(Boolean);
  const aSeg = path.split("/").filter(Boolean);
  if (pSeg.length !== aSeg.length) return null;
  const params: RouteParams = {};
  for (let i = 0; i < pSeg.length; i++) {
    const expected = pSeg[i];
    const actual = aSeg[i];
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function mapError(error: unknown): Response {
  if (isUnauthorizedError(error) || (error instanceof Error && error.message === "Unauthorized")) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (isForbiddenError(error)) {
    return json({ error: "Forbidden", code: error.code ?? "forbidden" }, 403);
  }
  if (isBadRequestError(error)) {
    return json({ error: error.message, code: "bad_request" }, 400);
  }
  if (isMethodNotAllowedError(error)) {
    return json({ error: "Method Not Allowed" }, 405, { allow: error.allow });
  }
  if (isDataApiError(error)) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  logError(logger, error, "request failed");
  return json({ error: "Internal Server Error" }, 500);
}

async function principalOf(ctx: RouteContext) {
  return requirePrincipal(ctx.options.sessionSource(ctx.request), ctx.request, ctx.options.appConfig);
}

async function healthRoute(ctx: RouteContext): Promise<Response> {
  const db = ctx.options.getDatabase ? await ctx.options.getDatabase() : undefined;
  const health = await getHealthResponse(db);
  let extras: Record<string, unknown> = {};
  if (ctx.options.healthExtras) {
    extras = await ctx.options.healthExtras();
  }
  return json({ ...health, ...extras });
}

function versionRoute(ctx: RouteContext): Promise<Response> {
  return Promise.resolve(json(getVersionResponse(ctx.options.appConfig)));
}

async function dataRoute(ctx: RouteContext): Promise<Response> {
  if (!ctx.options.dataApi || !ctx.options.getDatabase) {
    return notFound();
  }
  const principal = await principalOf(ctx);
  const db = await ctx.options.getDatabase();
  const page = await listResource(ctx.options.dataApi, db, {
    resource: ctx.params.resource,
    user: principal,
    limit: ctx.url.searchParams.get("limit"),
    offset: ctx.url.searchParams.get("offset"),
    user_id: ctx.url.searchParams.get("user_id"),
    schema: ctx.url.searchParams.get("schema"),
    table: ctx.url.searchParams.get("table"),
    sql: ctx.url.searchParams.get("sql"),
  });
  return json(page);
}

async function meRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  if (principal.kind === "user") {
    return json({
      kind: "user",
      user: { id: principal.user.id, email: principal.user.email, name: principal.user.name },
      roles: principal.roles,
    });
  }
  return json({
    kind: "api-key",
    keyId: principal.keyId,
    keyName: principal.name,
    roles: principal.roles,
  });
}

async function adminUsersRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  const users = await listUsers(principal);
  return json({ users });
}

async function adminSetRolesRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  const body = (await readJsonBody(ctx.request)) as { roles?: unknown };
  const roles = await setRoles(principal, ctx.params.id, body.roles);
  return json({ id: ctx.params.id, roles });
}

async function getPolicyRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  const policy = await getAccessPolicy(principal);
  return json(policy);
}

async function putPolicyRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  const body = (await readJsonBody(ctx.request)) as Record<string, unknown>;
  const policy = await setAccessPolicy(principal, body);
  return json(policy);
}

async function listKeysRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  const keys = await listApiKeys(principal);
  return json({ keys });
}

async function createKeyRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  const body = (await readJsonBody(ctx.request)) as Record<string, unknown>;
  const created = await createApiKey(principal, body);
  return json(created, 201);
}

async function revokeKeyRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  await revokeApiKey(principal, ctx.params.id);
  return json({ revoked: true });
}

async function listSettingsRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  const settings = await listSettings(principal);
  return json({ settings });
}

async function getSettingRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  const record = await getSettingRecord(principal, ctx.params.key);
  if (!record) return notFound();
  return json(record);
}

async function putSettingRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  const body = (await readJsonBody(ctx.request)) as { value?: unknown };
  if (!Object.prototype.hasOwnProperty.call(body, "value")) {
    throw new BadRequestError("Missing value");
  }
  const record = await setSetting(principal, ctx.params.key, body.value);
  return json(record);
}

async function deleteSettingRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  await deleteSetting(principal, ctx.params.key);
  return json({ deleted: true });
}

async function listAuditRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  const page = await listAudit(principal, {
    limit: ctx.url.searchParams.get("limit"),
    before: ctx.url.searchParams.get("before"),
    action: ctx.url.searchParams.get("action"),
    entity: ctx.url.searchParams.get("entity"),
    entity_id: ctx.url.searchParams.get("entity_id"),
    principal_id: ctx.url.searchParams.get("principal_id"),
  });
  return json(page);
}

async function resolveBuildTokens(options: PlatformHandlerOptions): Promise<DesignTokens> {
  const provided = options.designTokens;
  if (typeof provided === "function") {
    return buildTimeTokens(null, await provided());
  }
  return buildTimeTokens(null, provided ?? null);
}

async function readDesignOverride(): Promise<DesignOverride | null> {
  try {
    const value = await getSetting<unknown>("platform.design", null);
    if (value === null || value === undefined) return null;
    return validateDesignOverride(value);
  } catch (error) {
    if (error instanceof BadRequestError) return null;
    logError(logger, error, "design override read failed");
    return null;
  }
}

async function designPayload(options: PlatformHandlerOptions): Promise<{
  tokens: DesignTokens;
  override: DesignOverride | null;
}> {
  const build = await resolveBuildTokens(options);
  const override = await readDesignOverride();
  return { tokens: applyOverride(build, override), override };
}

async function getDesignRoute(ctx: RouteContext): Promise<Response> {
  const payload = await designPayload(ctx.options);
  return json(payload);
}

async function putDesignRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  requireRole(principal, "owner");
  const body = await readJsonBody(ctx.request);
  const override = validateDesignOverride(body);
  await setSetting(principal, "platform.design", override);
  await audit(principal, {
    action: "design.set",
    entity: "design",
    entityId: "platform.design",
    meta: { keys: Object.keys(override) },
  });
  return json(await designPayload(ctx.options));
}

async function deleteDesignRoute(ctx: RouteContext): Promise<Response> {
  const principal = await principalOf(ctx);
  requireRole(principal, "owner");
  try {
    await deleteSetting(principal, "platform.design");
  } catch (error) {
    if (!(error instanceof BadRequestError)) throw error;
  }
  await audit(principal, {
    action: "design.set",
    entity: "design",
    entityId: "platform.design",
    meta: { reset: true },
  });
  return json(await designPayload(ctx.options));
}

const routes: Route[] = [
  { method: "GET", pattern: "/health", handler: healthRoute },
  { method: "GET", pattern: "/version", handler: versionRoute },
  { method: "GET", pattern: "/design", handler: getDesignRoute },
  { method: "PUT", pattern: "/design", handler: putDesignRoute },
  { method: "DELETE", pattern: "/design", handler: deleteDesignRoute },
  { method: "GET", pattern: "/data/:resource", handler: dataRoute },
  { method: "GET", pattern: "/me", handler: meRoute },
  { method: "GET", pattern: "/admin/users", handler: adminUsersRoute },
  { method: "PUT", pattern: "/admin/users/:id/roles", handler: adminSetRolesRoute },
  { method: "GET", pattern: "/admin/access-policy", handler: getPolicyRoute },
  { method: "PUT", pattern: "/admin/access-policy", handler: putPolicyRoute },
  { method: "GET", pattern: "/api-keys", handler: listKeysRoute },
  { method: "POST", pattern: "/api-keys", handler: createKeyRoute },
  { method: "DELETE", pattern: "/api-keys/:id", handler: revokeKeyRoute },
  { method: "GET", pattern: "/settings", handler: listSettingsRoute },
  { method: "GET", pattern: "/settings/:key", handler: getSettingRoute },
  { method: "PUT", pattern: "/settings/:key", handler: putSettingRoute },
  { method: "DELETE", pattern: "/settings/:key", handler: deleteSettingRoute },
  { method: "GET", pattern: "/admin/audit", handler: listAuditRoute },
];

function methodsForPath(rest: string): { methods: HttpMethod[]; params: RouteParams } | null {
  const methods: HttpMethod[] = [];
  let params: RouteParams = {};
  for (const route of routes) {
    const matched = matchPattern(route.pattern, rest);
    if (matched) {
      methods.push(route.method);
      params = matched;
    }
  }
  return methods.length ? { methods, params } : null;
}

function findRoute(method: string, rest: string): { route: Route; params: RouteParams } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchPattern(route.pattern, rest);
    if (params) return { route, params };
  }
  return null;
}

/**
 * Platform HTTP adapter. Hosts mount one catch-all under `/api/platform/$`
 * and optional aliases that rewrite `/api/health`, `/api/version`,
 * `/api/data/:resource` onto the same handler.
 */
export function createPlatformHandler(
  options: PlatformHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      const url = new URL(request.url);
      const pathname = normalizePath(url.pathname);
      if (!pathname.startsWith(PLATFORM_PREFIX)) {
        return notFound();
      }
      const rest = pathname.slice(PLATFORM_PREFIX.length) || "/";
      const method = request.method.toUpperCase();
      const pathMatch = methodsForPath(rest);
      if (!pathMatch) return notFound();

      const allow = [...new Set([...pathMatch.methods, "HEAD", "OPTIONS"])].join(", ");
      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: { ...NO_STORE, allow },
        });
      }

      const matched = findRoute(method === "HEAD" ? "GET" : method, rest);
      if (!matched) {
        throw new MethodNotAllowedError(allow);
      }

      const response = await matched.route.handler({
        request,
        url,
        params: matched.params,
        options,
      });
      if (method === "HEAD") {
        return new Response(null, { status: response.status, headers: response.headers });
      }
      return response;
    } catch (error) {
      return mapError(error);
    }
  };
}


