import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defineDataApi } from "../src/data-api/index.js";
import { listPlatformHttpRoutes } from "../src/http/index.js";
import { defineMutations } from "../src/mutations/index.js";
import {
  APP_CONTRACT_VERSION,
  assertOpenApiShape,
  assertRegistryCoversRoutes,
  buildLlmsTxt,
  buildOpenApi,
  buildRegistry,
  capabilityCoversRoute,
  etagFor,
  fieldToJsonSchema,
  ifNoneMatch,
  mutationInputToJsonSchema,
} from "../src/registry/index.js";
import { defineAppConfig } from "../src/runtime/app-config.js";
import { getPlatformVersion } from "../src/runtime/platform-version.js";

const appConfig = defineAppConfig({
  name: "registry-test",
  version: "1.2.3",
  dataApiVersion: "0.5.1",
  ownerEmails: ["owner@example.com"],
});

const dataApi = defineDataApi({
  resources: [
    {
      name: "owned-items",
      relation: "owned_items",
      columns: ["id", "user_id", "value"],
      ownerColumn: "user_id",
      orderBy: "id",
      uniqueBy: "id",
    },
  ],
});

const mutations = defineMutations({
  mutations: [
    {
      name: "create-note",
      description: "Create a note owned by the caller",
      input: {
        fields: {
          title: { type: "string", required: true, maxLength: 80 },
          count: { type: "integer", min: 1, max: 9 },
          color: { type: "string", enum: ["red", "blue"] },
          tags: { type: "array", items: { type: "string", maxLength: 12 } },
        },
      },
      roles: ["member"],
      handler: async () => ({ ok: true }),
    },
  ],
});

const secretLike = [
  "postgres://",
  "postgresql://",
  "DATABASE_URL",
  "owned_items",
  "ownerColumn",
  "uniqueBy",
  "ownerEmails",
  "owner@example.com",
  "relation",
];

describe("buildRegistry", () => {
  it("covers every handler route (empty and populated registries)", () => {
    const routes = listPlatformHttpRoutes();
    expect(routes.length).toBeGreaterThan(10);
    const empty = buildRegistry({ appConfig });
    expect(() => assertRegistryCoversRoutes(empty.capabilities, routes)).not.toThrow();
    const full = buildRegistry({
      appConfig,
      dataApi,
      mutations,
      settingsKeys: ["platform.export.max-rows"],
      designMarkdownPresent: true,
    });
    expect(() => assertRegistryCoversRoutes(full.capabilities, routes)).not.toThrow();
    expect(
      capabilityCoversRoute(
        { method: "GET", path: "/api/platform/data/owned-items" },
        { method: "GET", pattern: "/data/:resource" },
      ),
    ).toBe(true);
    expect(
      capabilityCoversRoute(
        { method: "POST", path: "/api/platform/mutations/create-note" },
        { method: "POST", pattern: "/mutations/:name" },
      ),
    ).toBe(true);
  });

  it("describes each mutation with JSON Schema and each resource without SQL", () => {
    const registry = buildRegistry({
      appConfig,
      dataApi,
      mutations,
      settingsKeys: ["platform.export.max-rows"],
    });
    expect(registry.platformVersion).toBe(getPlatformVersion());
    expect(registry.appContractVersion).toBe(APP_CONTRACT_VERSION);
    expect(registry.application).toEqual({ name: "registry-test", version: "1.2.3" });
    const listed = registry.capabilities.find((item) => item.id === "data.list.owned-items");
    expect(listed?.path).toBe("/api/platform/data/owned-items");
    expect(listed?.pagination).toBe("cursor");
    const mutation = registry.capabilities.find((item) => item.id === "mutation.create-note");
    expect(mutation?.method).toBe("POST");
    expect(mutation?.path).toBe("/api/platform/mutations/create-note");
    expect(mutation?.input).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: {
        title: { type: "string", maxLength: 80 },
        count: { type: "integer", minimum: 1, maximum: 9 },
        color: { type: "string", enum: ["red", "blue"] },
        tags: { type: "array", items: { type: "string", maxLength: 12 } },
      },
    });
    const settings = registry.capabilities.find((item) => item.id === "settings.put");
    expect(settings?.description).toContain("platform.export.max-rows");
    const dump = JSON.stringify(registry);
    for (const leak of secretLike) {
      expect(dump).not.toContain(leak);
    }
    expect(dump).toContain("owned-items");
    expect(dump).not.toContain("gk_live");
  });

  it("keeps appContractVersion in sync with compatibility.json", () => {
    const compatibility = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "compatibility.json"), "utf8"),
    ) as { appContractVersion: number; platformVersion: string };
    expect(APP_CONTRACT_VERSION).toBe(compatibility.appContractVersion);
    expect(compatibility.appContractVersion).toBe(7);
    expect(compatibility.platformVersion).toBe(getPlatformVersion());
  });
});

describe("mutationInputToJsonSchema", () => {
  it("maps enum / min / max / items and rejects extra properties", () => {
    const schema = mutationInputToJsonSchema({
      fields: {
        name: { type: "string", required: true, min: 2, maxLength: 10 },
        n: { type: "number", min: 0, max: 1 },
        flag: { type: "boolean" },
        tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
        meta: {
          type: "object",
          properties: { note: { type: "string", required: true } },
        },
      },
    });
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["name"]);
    expect(schema.properties).toMatchObject({
      name: { type: "string", minLength: 2, maxLength: 10 },
      n: { type: "number", minimum: 0, maximum: 1 },
      flag: { type: "boolean" },
      tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["note"],
      },
    });
    expect(fieldToJsonSchema({ type: "integer", min: 1, max: 3 })).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 3,
    });
  });
});

describe("buildOpenApi", () => {
  it("is OpenAPI 3.1 with unique operationId and handler coverage", () => {
    const registry = buildRegistry({ appConfig, dataApi, mutations });
    const doc = buildOpenApi(registry);
    expect(() => assertOpenApiShape(doc)).not.toThrow();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "/" }]);
    expect(doc.components.securitySchemes.ApiKeyBearer).toBeTruthy();
    expect(doc.components.securitySchemes.SessionCookie).toBeTruthy();
    const putRoles = doc.paths["/api/platform/admin/users/{id}/roles"]?.put as {
      operationId: string;
      parameters: { name: string; in: string }[];
    };
    expect(putRoles.operationId).toBe("admin.users.set-roles");
    expect(putRoles.parameters.some((param) => param.in === "path" && param.name === "id")).toBe(true);
    const dump = JSON.stringify(doc);
    for (const leak of ["owned_items", "ownerColumn", "postgres://", "owner@example.com"]) {
      expect(dump).not.toContain(leak);
    }
    expect(() => assertRegistryCoversRoutes(registry.capabilities, listPlatformHttpRoutes())).not.toThrow();
  });
});

describe("etag and llms.txt", () => {
  it("quotes a hex digest and matches If-None-Match lists", () => {
    const a = etagFor("hello");
    const b = etagFor("world");
    expect(a).toMatch(/^"[0-9a-f]{32}"$/);
    expect(a).not.toBe(b);
    const request = new Request("https://example.test/", { headers: { "if-none-match": `W/${a}, ${b}` } });
    expect(ifNoneMatch(request, a)).toBe(true);
    expect(ifNoneMatch(new Request("https://example.test/"), a)).toBe(false);
  });

  it("llms.txt has the three curl examples and no secrets", () => {
    const text = buildLlmsTxt(buildRegistry({ appConfig, dataApi, mutations }));
    expect(text).toContain("Authorization: Bearer $API_KEY");
    expect(text).toContain("/api/platform/me");
    expect(text).toContain("cursor=");
    expect(text).toContain("Idempotency-Key");
    expect(text).toContain("/api/platform/registry");
    expect(text).toContain("/api/platform/openapi.json");
    expect(text).toContain("user_id");
    expect(text.toLowerCase()).toContain("owner-scoped");
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("DATABASE_URL");
    expect(text).not.toContain("owned_items");
    expect(text).not.toContain("gk_live");
  });
});
