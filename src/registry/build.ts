import type { AppConfig } from "../runtime/types.js";
import { getPlatformVersion } from "../runtime/platform-version.js";
import type { DataApiRegistry } from "../data-api/types.js";
import { listPublishedResources } from "../data-api/registry.js";
import type { MutationRegistry } from "../mutations/types.js";
import { mutationInputToJsonSchema } from "./json-schema.js";
import type { Capability, JsonSchema, PlatformRegistry } from "./types.js";

/** Keep in sync with repository-root compatibility.json. */
export const APP_CONTRACT_VERSION = 7;

export type BuildRegistryInput = {
  appConfig: AppConfig;
  dataApi?: DataApiRegistry;
  mutations?: MutationRegistry;
  settingsKeys?: readonly string[];
  designMarkdownPresent?: boolean;
};

const PLATFORM = "/api/platform";

const LIST_QUERY: JsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    offset: { type: "integer", minimum: 0 },
    cursor: { type: "string", description: "Opaque keyset cursor from a previous page" },
  },
};

const EXPORT_QUERY: JsonSchema = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["csv", "json"] },
    limit: { type: "integer", minimum: 1 },
  },
  required: ["format"],
};

function cap(partial: Capability): Capability {
  return {
    pagination: partial.pagination ?? null,
    ...partial,
  };
}

function staticCapabilities(): Capability[] {
  return [
    cap({
      id: "health.get",
      kind: "read",
      method: "GET",
      path: `${PLATFORM}/health`,
      roles: [],
      description: "Liveness and database probe. Public. No secrets.",
      input: null,
      output: { type: "object", properties: { status: { type: "string" }, platformVersion: { type: "string" } } },
    }),
    cap({
      id: "version.get",
      kind: "read",
      method: "GET",
      path: `${PLATFORM}/version`,
      roles: [],
      description: "Application and platform versions. Public.",
      input: null,
      output: {
        type: "object",
        properties: {
          application: { type: "string" },
          applicationVersion: { type: "string" },
          platformVersion: { type: "string" },
          dataApiVersion: { type: "string" },
        },
      },
    }),
    cap({
      id: "me.get",
      kind: "read",
      method: "GET",
      path: `${PLATFORM}/me`,
      roles: ["member"],
      description: "Current principal (session user or API key) and roles.",
      input: null,
      output: { type: "object", properties: { kind: { type: "string" }, roles: { type: "array", items: { type: "string" } } } },
    }),
    cap({
      id: "registry.get",
      kind: "read",
      method: "GET",
      path: `${PLATFORM}/registry`,
      roles: [],
      description: "Machine-readable capabilities. Public unless registryPublic=false.",
      input: null,
      output: "PlatformRegistry JSON",
    }),
    cap({
      id: "openapi.get",
      kind: "read",
      method: "GET",
      path: `${PLATFORM}/openapi.json`,
      roles: [],
      description: "OpenAPI 3.1 document of the same capabilities.",
      input: null,
      output: "OpenAPI 3.1.0 JSON",
    }),
    cap({
      id: "llms.get",
      kind: "read",
      method: "GET",
      path: `${PLATFORM}/llms.txt`,
      roles: [],
      description: "Short Markdown for an LLM: how to get a key and call the API.",
      input: null,
      output: "text/plain Markdown",
    }),
    cap({
      id: "data.resources",
      kind: "read",
      method: "GET",
      path: `${PLATFORM}/data`,
      roles: ["member"],
      description: "Registered data-API resources {name, columns, orderBy}. No SQL identifiers.",
      input: null,
      output: { type: "object", properties: { resources: { type: "array" } } },
    }),
    cap({
      id: "mutations.list",
      kind: "read",
      method: "GET",
      path: `${PLATFORM}/mutations`,
      roles: ["member"],
      description: "Mutations the caller can run (filtered by role).",
      input: null,
      output: { type: "object", properties: { mutations: { type: "array" } } },
    }),
    cap({
      id: "settings.list",
      kind: "settings",
      method: "GET",
      path: `${PLATFORM}/settings`,
      roles: ["member"],
      description: "List JSON settings. Values are visible to every member; do not store secrets.",
      input: null,
      output: { type: "object", properties: { settings: { type: "array" } } },
    }),
    cap({
      id: "settings.get",
      kind: "settings",
      method: "GET",
      path: `${PLATFORM}/settings/{key}`,
      roles: ["member"],
      description: "Read one setting. 404 if missing.",
      input: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
      output: { type: "object", properties: { key: { type: "string" }, value: {} } },
    }),
    cap({
      id: "settings.put",
      kind: "settings",
      method: "PUT",
      path: `${PLATFORM}/settings/{key}`,
      roles: ["admin"],
      description: "Write a setting. Body { value }. platform.* requires owner.",
      input: {
        type: "object",
        properties: { key: { type: "string" }, value: {} },
        required: ["key", "value"],
      },
      output: { type: "object", properties: { key: { type: "string" }, value: {} } },
    }),
    cap({
      id: "settings.delete",
      kind: "settings",
      method: "DELETE",
      path: `${PLATFORM}/settings/{key}`,
      roles: ["admin"],
      description: "Delete a setting. platform.* requires owner.",
      input: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
      output: { type: "object", properties: { deleted: { type: "boolean" } } },
    }),
    cap({
      id: "design.get",
      kind: "design",
      method: "GET",
      path: `${PLATFORM}/design`,
      roles: [],
      description: "Public merged design tokens. Never returns markdown, Voice, or secrets.",
      input: null,
      output: { type: "object", properties: { tokens: { type: "object" }, override: {} } },
    }),
    cap({
      id: "design.put",
      kind: "design",
      method: "PUT",
      path: `${PLATFORM}/design`,
      roles: ["owner"],
      description: "Owner form overlay for design tokens.",
      input: { type: "object" },
      output: { type: "object", properties: { tokens: { type: "object" } } },
    }),
    cap({
      id: "design.delete",
      kind: "design",
      method: "DELETE",
      path: `${PLATFORM}/design`,
      roles: ["owner"],
      description: "Reset the design overlay to build-time tokens.",
      input: null,
      output: { type: "object", properties: { tokens: { type: "object" } } },
    }),
    cap({
      id: "design.import",
      kind: "design",
      method: "POST",
      path: `${PLATFORM}/design/import`,
      roles: ["owner"],
      description: "Import a design.md document or a gallery preset. Body { markdown } or { preset }.",
      input: {
        type: "object",
        properties: { markdown: { type: "string" }, preset: { type: "string" } },
      },
      output: { type: "object", properties: { tokens: { type: "object" } } },
    }),
    cap({
      id: "design.export",
      kind: "design",
      method: "GET",
      path: `${PLATFORM}/design/export`,
      roles: ["owner"],
      description: "Download stored or build-time design.md (text/markdown).",
      input: null,
      output: "text/markdown",
    }),
    cap({
      id: "design.gallery",
      kind: "design",
      method: "GET",
      path: `${PLATFORM}/design/gallery`,
      roles: ["owner"],
      description: "List gallery presets {id, name, tagline, colors}.",
      input: null,
      output: { type: "object", properties: { presets: { type: "array" } } },
    }),
    cap({
      id: "api-keys.list",
      kind: "admin",
      method: "GET",
      path: `${PLATFORM}/api-keys`,
      roles: ["member"],
      description: "List the caller's API keys (hashes only, never plaintext).",
      input: null,
      output: { type: "object", properties: { keys: { type: "array" } } },
    }),
    cap({
      id: "api-keys.create",
      kind: "admin",
      method: "POST",
      path: `${PLATFORM}/api-keys`,
      roles: ["member"],
      description: "Create an API key. Plaintext gk_… is returned once.",
      input: {
        type: "object",
        properties: {
          name: { type: "string" },
          roles: { type: "array", items: { type: "string", enum: ["owner", "admin", "member"] } },
        },
        required: ["name", "roles"],
      },
      output: { type: "object", properties: { id: { type: "string" }, key: { type: "string" } } },
    }),
    cap({
      id: "api-keys.revoke",
      kind: "admin",
      method: "DELETE",
      path: `${PLATFORM}/api-keys/{id}`,
      roles: ["member"],
      description: "Revoke a key the caller owns, or any key if admin+.",
      input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      output: { type: "object", properties: { revoked: { type: "boolean" } } },
    }),
    cap({
      id: "admin.users.list",
      kind: "admin",
      method: "GET",
      path: `${PLATFORM}/admin/users`,
      roles: ["admin"],
      description: "List users and roles.",
      input: null,
      output: { type: "object", properties: { users: { type: "array" } } },
    }),
    cap({
      id: "admin.users.set-roles",
      kind: "admin",
      method: "PUT",
      path: `${PLATFORM}/admin/users/{id}/roles`,
      roles: ["admin"],
      description: "Set roles. Last owner cannot be dropped. Admin cannot change an owner.",
      input: {
        type: "object",
        properties: { id: { type: "string" }, roles: { type: "array", items: { type: "string" } } },
        required: ["id", "roles"],
      },
      output: { type: "object", properties: { id: { type: "string" }, roles: { type: "array" } } },
    }),
    cap({
      id: "admin.access-policy.get",
      kind: "admin",
      method: "GET",
      path: `${PLATFORM}/admin/access-policy`,
      roles: ["owner"],
      description: "Read the access policy (open / allowlist).",
      input: null,
      output: { type: "object" },
    }),
    cap({
      id: "admin.access-policy.put",
      kind: "admin",
      method: "PUT",
      path: `${PLATFORM}/admin/access-policy`,
      roles: ["owner"],
      description: "Replace the access policy.",
      input: { type: "object", properties: { mode: { type: "string", enum: ["open", "allowlist"] } } },
      output: { type: "object" },
    }),
    cap({
      id: "audit.list",
      kind: "audit",
      method: "GET",
      path: `${PLATFORM}/admin/audit`,
      roles: ["admin"],
      description: "Append-only audit log. Cursor by id desc. Meta is redacted; no secrets.",
      input: {
        type: "object",
        properties: {
          limit: { type: "integer" },
          before: { type: "integer" },
          action: { type: "string" },
          entity: { type: "string" },
        },
      },
      output: { type: "object", properties: { entries: { type: "array" }, nextBefore: {} } },
    }),
  ];
}

function dataCapabilities(dataApi?: DataApiRegistry): Capability[] {
  const published = dataApi ? listPublishedResources(dataApi) : [];
  if (published.length === 0) {
    return [
      cap({
        id: "data.list",
        kind: "read",
        method: "GET",
        path: `${PLATFORM}/data/{resource}`,
        roles: ["member"],
        description:
          "Owner-scoped list of one registered resource. Query limit, offset, cursor. Client user_id is ignored.",
        input: LIST_QUERY,
        output: {
          type: "object",
          properties: {
            items: { type: "array" },
            limit: { type: "integer" },
            offset: { type: "integer" },
            nextCursor: { type: ["string", "null"] },
          },
        },
        pagination: "cursor",
      }),
      cap({
        id: "data.export",
        kind: "export",
        method: "GET",
        path: `${PLATFORM}/data/{resource}/export`,
        roles: ["member"],
        description: "Owner-scoped CSV or NDJSON export of one resource. Query format=csv|json.",
        input: EXPORT_QUERY,
        output: "text/csv or application/x-ndjson stream",
      }),
    ];
  }
  const out: Capability[] = [];
  for (const resource of published) {
    out.push(
      cap({
        id: `data.list.${resource.name}`,
        kind: "read",
        method: "GET",
        path: `${PLATFORM}/data/${resource.name}`,
        roles: ["member"],
        description: `Owner-scoped list of ${resource.name} (columns: ${resource.columns.join(", ")}; orderBy ${resource.orderBy}). Cursor pagination. Client user_id is ignored.`,
        input: LIST_QUERY,
        output: {
          type: "object",
          properties: {
            items: { type: "array" },
            limit: { type: "integer" },
            offset: { type: "integer" },
            nextCursor: { type: ["string", "null"] },
          },
        },
        pagination: "cursor",
      }),
      cap({
        id: `data.export.${resource.name}`,
        kind: "export",
        method: "GET",
        path: `${PLATFORM}/data/${resource.name}/export`,
        roles: ["member"],
        description: `Owner-scoped CSV/NDJSON export of ${resource.name}.`,
        input: EXPORT_QUERY,
        output: "text/csv or application/x-ndjson stream",
      }),
    );
  }
  return out;
}

function mutationCapabilities(mutations?: MutationRegistry): Capability[] {
  const list = mutations?.mutations ?? [];
  if (list.length === 0) {
    return [
      cap({
        id: "mutation.run",
        kind: "write",
        method: "POST",
        path: `${PLATFORM}/mutations/{name}`,
        roles: ["member"],
        description:
          "Run a registered mutation. Body = input. Optional Idempotency-Key header. Client user_id is never identity.",
        input: { type: "object" },
        output: { type: "object", properties: { ok: { type: "boolean" }, result: {} } },
      }),
    ];
  }
  return list.map((mutation) =>
    cap({
      id: `mutation.${mutation.name}`,
      kind: "write",
      method: "POST",
      path: `${PLATFORM}/mutations/${mutation.name}`,
      roles: mutation.roles,
      description: mutation.description,
      input: mutationInputToJsonSchema(mutation.input),
      output: { type: "object", properties: { ok: { const: true }, result: {} } },
    }),
  );
}

function annotateSettingsKeys(
  capabilities: Capability[],
  keys?: readonly string[],
  designMarkdownPresent?: boolean,
): Capability[] {
  return capabilities.map((item) => {
    let description = item.description;
    if (item.id.startsWith("settings.") && keys && keys.length > 0) {
      description = `${description} Known keys: ${keys.join(", ")}.`;
    }
    if (item.id === "design.export") {
      description = designMarkdownPresent
        ? `${description} Host build-time design.md is present.`
        : `${description} Host did not pass designMarkdown; stored markdown only.`;
    }
    return description === item.description ? item : { ...item, description };
  });
}

/**
 * Describe what this deployment can do. No secrets, no SQL identifiers
 * (relation / schema / owner column), no ownerEmails.
 */
export function buildRegistry(input: BuildRegistryInput): PlatformRegistry {
  const capabilities = [
    ...staticCapabilities(),
    ...dataCapabilities(input.dataApi),
    ...mutationCapabilities(input.mutations),
  ];
  return {
    platformVersion: getPlatformVersion(),
    appContractVersion: APP_CONTRACT_VERSION,
    application: { name: input.appConfig.name, version: input.appConfig.version },
    auth: {
      schemes: [
        {
          type: "apiKey",
          header: "Authorization",
          format: "Bearer gk_...",
          howToGet: "/admin/api-keys",
        },
        { type: "session" },
      ],
      roles: ["owner", "admin", "member"],
    },
    capabilities: annotateSettingsKeys(capabilities, input.settingsKeys, input.designMarkdownPresent),
  };
}
