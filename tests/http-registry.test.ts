import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthSessionSource, type AuthUser } from "../src/auth/index.js";
import { defineDataApi } from "../src/data-api/index.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";
import { createPlatformHandler, type PlatformHandlerOptions } from "../src/http/index.js";
import { setLogSink } from "../src/logging/index.js";
import { defineMutations } from "../src/mutations/index.js";
import { defineAppConfig } from "../src/runtime/app-config.js";

const alice: AuthUser = { id: "user-alice", email: "alice@example.com", name: "Alice", image: null };

const appConfig = defineAppConfig({
  name: "http-test",
  version: "0.0.0",
  dataApiVersion: "0.5.1",
});

const dataApi = defineDataApi({
  resources: [
    {
      name: "owned-items",
      relation: "owned_items",
      columns: ["id", "user_id", "value"],
      ownerColumn: "user_id",
      orderBy: "id",
    },
  ],
});

const mutations = defineMutations({
  mutations: [
    {
      name: "create-note",
      description: "Create a note",
      input: {
        fields: {
          text: { type: "string", required: true, maxLength: 40 },
          color: { type: "string", enum: ["red", "blue"] },
        },
      },
      roles: ["member"],
      handler: async () => ({ id: "n1" }),
    },
  ],
});

function sourceFor(user: AuthUser | null) {
  return () =>
    createAuthSessionSource({
      async getSession() {
        return user ? { user } : null;
      },
    });
}

function handlerFor(user: AuthUser | null, extra: Partial<PlatformHandlerOptions> = {}) {
  return createPlatformHandler({
    appConfig,
    sessionSource: sourceFor(user),
    dataApi,
    mutations,
    getDatabase,
    settingsKeys: ["platform.export.max-rows"],
    ...extra,
  });
}

async function call(
  handle: (request: Request) => Promise<Response>,
  path: string,
  init: RequestInit = {},
) {
  const response = await handle(new Request(`https://example.test${path}`, init));
  const text = await response.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, headers: response.headers, text };
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  setLogSink(() => undefined);
  await resetDatabaseForTests();
});

afterEach(async () => {
  setLogSink(null);
  await resetDatabaseForTests();
});

describe("GET /api/platform/registry", () => {
  it("is public JSON with capabilities and no SQL identifiers", async () => {
    const { status, body, headers } = await call(handlerFor(null), "/api/platform/registry");
    expect(status).toBe(200);
    expect(headers.get("content-type")).toContain("application/json");
    expect(headers.get("cache-control")).toBe("public, max-age=300");
    expect(headers.get("etag")).toMatch(/^"[0-9a-f]{32}"$/);
    const registry = body as {
      application: { name: string };
      capabilities: { id: string; path: string }[];
    };
    expect(registry.application.name).toBe("http-test");
    const ids = registry.capabilities.map((item) => item.id);
    expect(ids).toContain("data.list.owned-items");
    expect(ids).toContain("data.export.owned-items");
    expect(ids).toContain("mutation.create-note");
    expect(ids).toContain("health.get");
    const dump = JSON.stringify(body);
    expect(dump).not.toContain("owned_items");
    expect(dump).not.toContain("ownerColumn");
    expect(dump).not.toContain("postgres://");
    expect(dump).toContain("platform.export.max-rows");
  });

  it("returns 401 when registryPublic=false without a principal", async () => {
    const { status, body } = await call(
      handlerFor(null, { registryPublic: false }),
      "/api/platform/registry",
    );
    expect(status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns the registry to a principal when registryPublic=false", async () => {
    await runMigrations();
    const { status, body } = await call(
      handlerFor(alice, { registryPublic: false }),
      "/api/platform/registry",
    );
    expect(status).toBe(200);
    expect((body as { application: { name: string } }).application.name).toBe("http-test");
  });

  it("sends 304 when If-None-Match matches", async () => {
    const first = await call(handlerFor(null), "/api/platform/registry");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const second = await call(handlerFor(null), "/api/platform/registry", {
      headers: { "if-none-match": etag ?? "" },
    });
    expect(second.status).toBe(304);
    expect(second.text).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
  });
});

describe("GET /api/platform/openapi.json", () => {
  it("is public OpenAPI 3.1 with unique operationId", async () => {
    const { status, body, headers } = await call(handlerFor(null), "/api/platform/openapi.json");
    expect(status).toBe(200);
    expect(headers.get("cache-control")).toBe("public, max-age=300");
    const doc = body as {
      openapi: string;
      info: { title: string };
      servers: { url: string }[];
      paths: Record<string, Record<string, { operationId: string }>>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("http-test");
    expect(doc.servers).toEqual([{ url: "/" }]);
    expect(doc.components.securitySchemes.ApiKeyBearer).toBeTruthy();
    const ids = Object.values(doc.paths).flatMap((item) =>
      Object.values(item).map((op) => op.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("mutation.create-note");
    const mutation = doc.paths["/api/platform/mutations/create-note"]?.post as unknown as {
      requestBody: { content: { "application/json": { schema: { properties: Record<string, unknown> } } } };
    };
    expect(mutation.requestBody.content["application/json"].schema.properties).toMatchObject({
      text: { type: "string", maxLength: 40 },
      color: { enum: ["red", "blue"] },
    });
  });

  it("is principal-only when registryPublic=false", async () => {
    const { status } = await call(
      handlerFor(null, { registryPublic: false }),
      "/api/platform/openapi.json",
    );
    expect(status).toBe(401);
  });
});

describe("GET /api/platform/llms.txt", () => {
  it("is public Markdown with examples and no secrets", async () => {
    const { status, text, headers } = await call(handlerFor(null), "/api/platform/llms.txt");
    expect(status).toBe(200);
    expect(headers.get("content-type")).toContain("text/plain");
    expect(headers.get("cache-control")).toBe("public, max-age=300");
    expect(text).toContain("# http-test");
    expect(text).toContain("/api/platform/me");
    expect(text).toContain("$API_KEY");
    expect(text).toContain("cursor=");
    expect(text).toContain("Idempotency-Key");
    expect(text).toContain("/api/platform/registry");
    expect(text).toContain("/api/platform/openapi.json");
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("DATABASE_URL");
    expect(text).not.toContain("owned_items");
    expect(text).not.toContain("gk_live");
  });
});
