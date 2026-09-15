import type { Capability, JsonSchema, OpenApiDocument, PlatformRegistry } from "./types.js";
import { ERROR_SCHEMA } from "./json-schema.js";

const ERROR_REF = { $ref: "#/components/schemas/Error" };

function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: ERROR_REF } },
  };
}

function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1] ?? "");
}

function pathParameters(capability: Capability): Record<string, unknown>[] {
  const properties =
    capability.input && typeof capability.input === "object"
      ? ((capability.input.properties ?? {}) as Record<string, JsonSchema>)
      : {};
  return pathParamNames(capability.path).map((name) => ({
    name,
    in: "path",
    required: true,
    schema: properties[name] ?? { type: "string" },
  }));
}

function queryParameters(capability: Capability): Record<string, unknown>[] {
  if (!capability.input || capability.method !== "GET") return [];
  const properties = (capability.input.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((capability.input.required as string[] | undefined) ?? []);
  const pathNames = new Set(pathParamNames(capability.path));
  const out: Record<string, unknown>[] = [];
  for (const [name, schema] of Object.entries(properties)) {
    if (pathNames.has(name)) continue;
    out.push({
      name,
      in: "query",
      required: required.has(name),
      schema,
    });
  }
  return out;
}

function operationFrom(capability: Capability): Record<string, unknown> {
  const security = capability.roles.length === 0 ? [] : [{ ApiKeyBearer: [] }, { SessionCookie: [] }];
  const parameters = [...pathParameters(capability), ...queryParameters(capability)];
  const op: Record<string, unknown> = {
    operationId: capability.id,
    tags: [capability.kind],
    summary: capability.description,
    description: capability.description,
    security,
    responses: {
      "200": {
        description: "Success",
        content:
          typeof capability.output === "string"
            ? { "text/plain": { schema: { type: "string", description: capability.output } } }
            : { "application/json": { schema: capability.output } },
      },
      "400": errorResponse("Invalid input"),
      "401": errorResponse("Unauthorized"),
      "403": errorResponse("Forbidden"),
      "404": errorResponse("Not found"),
    },
  };
  if (parameters.length) op.parameters = parameters;
  if (capability.input && (capability.method === "POST" || capability.method === "PUT")) {
    op.requestBody = {
      required: true,
      content: { "application/json": { schema: capability.input } },
    };
  }
  return op;
}

export function buildOpenApi(registry: PlatformRegistry): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();
  for (const capability of registry.capabilities) {
    tags.add(capability.kind);
    const item = paths[capability.path] ?? {};
    item[capability.method.toLowerCase()] = operationFrom(capability);
    paths[capability.path] = item;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: registry.application.name,
      version: registry.application.version,
      description: `grok-app-platform ${registry.platformVersion} (appContractVersion ${registry.appContractVersion})`,
    },
    servers: [{ url: "/" }],
    security: [{ ApiKeyBearer: [] }, { SessionCookie: [] }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        ApiKeyBearer: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "gk_",
          description: "Create at /admin/api-keys. Header: Authorization: Bearer gk_…",
        },
        SessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
          description: "Browser session cookie after Google sign-in.",
        },
      },
      schemas: {
        Error: ERROR_SCHEMA,
      },
    },
  };
}

export function assertOpenApiShape(doc: OpenApiDocument): void {
  if (doc.openapi !== "3.1.0") throw new Error("openapi must be 3.1.0");
  if (!doc.info?.title || !doc.info.version) throw new Error("info.title and info.version required");
  if (!Array.isArray(doc.servers) || doc.servers.length === 0) throw new Error("servers required");
  if (doc.servers[0]?.url !== "/") throw new Error("servers[0].url must be /");
  const schemes = doc.components?.securitySchemes ?? {};
  if (!schemes.ApiKeyBearer || !schemes.SessionCookie) throw new Error("securitySchemes missing");
  const seen = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!path.startsWith("/")) throw new Error(`path ${path} must start with /`);
    for (const [method, op] of Object.entries(item)) {
      if (typeof op !== "object" || !op) continue;
      const operation = op as {
        operationId?: string;
        responses?: Record<string, unknown>;
        parameters?: { in?: string; name?: string }[];
      };
      const id = operation.operationId;
      if (!id) throw new Error(`missing operationId on ${method} ${path}`);
      if (seen.has(id)) throw new Error(`duplicate operationId ${id}`);
      seen.add(id);
      for (const status of ["200", "400", "401", "403", "404"]) {
        if (!operation.responses?.[status]) throw new Error(`${id} missing response ${status}`);
      }
      const pathNames = pathParamNames(path);
      const declared = new Set(
        (operation.parameters ?? []).filter((param) => param.in === "path").map((param) => param.name),
      );
      for (const name of pathNames) {
        if (!declared.has(name)) throw new Error(`${id} missing path parameter ${name}`);
      }
    }
  }
}
