import { isUnauthorizedError, requireUser, type AuthSessionSource } from "../auth/index.js";
import { isDataApiError, listResource, type DataApiRegistry } from "../data-api/index.js";
import type { Database } from "../database/types.js";
import { createLogger, logError } from "../logging/index.js";
import type { AppConfig } from "../runtime/types.js";
import { getHealthResponse } from "../runtime/health.js";
import { getVersionResponse } from "../runtime/version.js";

const logger = createLogger("http");
const PLATFORM_PREFIX = "/api/platform";
const NO_STORE = { "cache-control": "no-store" };

export type PlatformHandlerOptions = {
  appConfig: AppConfig;
  sessionSource: (request: Request) => AuthSessionSource;
  dataApi?: DataApiRegistry;
  getDatabase?: () => Promise<Database>;
  healthExtras?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
};

type RouteParams = Record<string, string>;

type RouteContext = {
  request: Request;
  url: URL;
  params: RouteParams;
  options: PlatformHandlerOptions;
};

type Route = {
  method: "GET";
  pattern: string;
  handler: (ctx: RouteContext) => Promise<Response>;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
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
  if (isDataApiError(error)) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  logError(logger, error, "request failed");
  return json({ error: "Internal Server Error" }, 500);
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
  const user = await requireUser(ctx.options.sessionSource(ctx.request));
  const db = await ctx.options.getDatabase();
  const page = await listResource(ctx.options.dataApi, db, {
    resource: ctx.params.resource,
    user,
    limit: ctx.url.searchParams.get("limit"),
    offset: ctx.url.searchParams.get("offset"),
    user_id: ctx.url.searchParams.get("user_id"),
    schema: ctx.url.searchParams.get("schema"),
    table: ctx.url.searchParams.get("table"),
    sql: ctx.url.searchParams.get("sql"),
  });
  return json(page);
}

const routes: Route[] = [
  { method: "GET", pattern: "/health", handler: healthRoute },
  { method: "GET", pattern: "/version", handler: versionRoute },
  { method: "GET", pattern: "/data/:resource", handler: dataRoute },
];

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
      const matched = findRoute("GET", rest);
      if (!matched) return notFound();

      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: { ...NO_STORE, allow: "GET, HEAD, OPTIONS" },
        });
      }
      if (method === "HEAD") {
        const response = await matched.route.handler({
          request,
          url,
          params: matched.params,
          options,
        });
        return new Response(null, { status: response.status, headers: response.headers });
      }
      if (method !== "GET") return notFound();

      return await matched.route.handler({
        request,
        url,
        params: matched.params,
        options,
      });
    } catch (error) {
      return mapError(error);
    }
  };
}
