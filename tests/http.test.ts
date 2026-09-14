import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthSessionSource, type AuthUser } from "../src/auth/index.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";
import { defineDataApi } from "../src/data-api/index.js";
import { createPlatformHandler } from "../src/http/index.js";
import { setLogSink } from "../src/logging/index.js";
import { defineAppConfig } from "../src/runtime/app-config.js";
import { getPlatformVersion } from "../src/runtime/platform-version.js";

const alice: AuthUser = { id: "user-alice", email: "a@example.com", name: "Alice", image: null };
const bob: AuthUser = { id: "user-bob", email: "b@example.com", name: "Bob", image: null };

const appConfig = defineAppConfig({
  name: "http-test",
  version: "0.0.0",
  dataApiVersion: "0.5.1",
});

const resource = {
  name: "owned-items",
  relation: "owned_items",
  columns: ["id", "user_id", "value", "created_at"] as const,
  ownerColumn: "user_id",
  orderBy: "created_at",
  orderDirection: "desc" as const,
  uniqueBy: "id",
};

function registry() {
  return defineDataApi({ resources: [resource] });
}

function sourceFor(user: AuthUser | null) {
  return () =>
    createAuthSessionSource({
      async getSession() {
        return user ? { user } : null;
      },
    });
}

async function seed() {
  await runMigrations();
  const db = await getDatabase();
  await db.query(`
    create table app.owned_items (
      id text primary key,
      user_id text not null,
      value text not null,
      created_at timestamptz not null default now()
    )
  `);
  await db.query(`
    create view api.owned_items as
    select id, user_id, value, created_at
    from app.owned_items
  `);
  await db.query(
    `insert into app.owned_items (id, user_id, value, created_at) values
      ($1, $2, $3, $4),
      ($5, $6, $7, $8),
      ($9, $10, $11, $12)`,
    [
      "a1",
      alice.id,
      "alice-1",
      "2026-01-01T00:00:00Z",
      "a2",
      alice.id,
      "alice-2",
      "2026-01-02T00:00:00Z",
      "b1",
      bob.id,
      "bob-1",
      "2026-01-03T00:00:00Z",
    ],
  );
  return db;
}

function handlerFor(user: AuthUser | null) {
  return createPlatformHandler({
    appConfig,
    sessionSource: sourceFor(user),
    dataApi: registry(),
    getDatabase,
  });
}

async function call(
  handle: (request: Request) => Promise<Response>,
  path: string,
  init: RequestInit = {},
) {
  const response = await handle(new Request(`https://example.test${path}`, init));
  const text = await response.text();
  let body: unknown = null;
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

describe("createPlatformHandler", () => {
  it("GET /api/platform/health is ok on migrated PGlite", async () => {
    await runMigrations();
    const { status, body, headers } = await call(handlerFor(null), "/api/platform/health");
    expect(status).toBe(200);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      status: "ok",
      platformVersion: getPlatformVersion(),
      database: { status: "ok", engine: "pglite" },
    });
  });

  it("GET /api/platform/version returns app + platform versions", async () => {
    const { status, body } = await call(handlerFor(null), "/api/platform/version");
    expect(status).toBe(200);
    expect(body).toEqual({
      application: "http-test",
      applicationVersion: "0.0.0",
      platformVersion: getPlatformVersion(),
      dataApiVersion: "0.5.1",
    });
  });

  it("lists owner-scoped rows when a session is present", async () => {
    await seed();
    const { status, body } = await call(handlerFor(alice), "/api/platform/data/owned-items");
    expect(status).toBe(200);
    const items = (body as { items: { id: string }[] }).items;
    expect(items.map((row) => row.id)).toEqual(["a2", "a1"]);
  });

  it("returns 401 without a session", async () => {
    await seed();
    const { status, body } = await call(handlerFor(null), "/api/platform/data/owned-items");
    expect(status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 404 not_found for an unknown route", async () => {
    const { status, body } = await call(handlerFor(null), "/api/platform/nope");
    expect(status).toBe(404);
    expect(body).toEqual({ error: "Not Found", code: "not_found" });
  });

  it("returns 404 for an unknown resource", async () => {
    await seed();
    const { status, body } = await call(handlerFor(alice), "/api/platform/data/unregistered-items");
    expect(status).toBe(404);
    expect(body).toEqual({ error: "Resource is not available", code: "unknown_resource" });
  });

  it("ignores client sql/schema/user_id and never returns SQL", async () => {
    await seed();
    const { status, body, text } = await call(
      handlerFor(alice),
      "/api/platform/data/owned-items?sql=SELECT%20*%20FROM%20app.owned_items&schema=private&table=owned_items&user_id=user-bob",
    );
    expect(status).toBe(200);
    const items = (body as { items: { id: string; user_id: string }[] }).items;
    expect(items.every((row) => row.user_id === alice.id)).toBe(true);
    expect(items.some((row) => row.user_id === bob.id)).toBe(false);
    expect(text).not.toMatch(/SELECT |app\.owned_items|private/i);
  });

  it("maps unexpected errors to 500 without leaking SQL or connection strings", async () => {
    const handle = createPlatformHandler({
      appConfig,
      sessionSource: sourceFor(alice),
      dataApi: registry(),
      getDatabase: async () => {
        throw new Error("relation api.owned_items does not exist postgres://u:p@h/db");
      },
    });
    const { status, body, text } = await call(handle, "/api/platform/data/owned-items");
    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal Server Error" });
    expect(text).not.toMatch(/owned_items|postgres:\/\/|u:p@h/);
  });

  it("merges healthExtras and answers OPTIONS/HEAD", async () => {
    await runMigrations();
    const handle = createPlatformHandler({
      appConfig,
      sessionSource: sourceFor(null),
      getDatabase,
      healthExtras: async () => ({ extra: true }),
    });
    const health = await call(handle, "/api/platform/health");
    expect(health.status).toBe(200);
    expect((health.body as { extra: boolean }).extra).toBe(true);

    const options = await call(handle, "/api/platform/health", { method: "OPTIONS" });
    expect(options.status).toBe(204);
    expect(options.headers.get("allow")).toMatch(/GET/);

    const head = await call(handle, "/api/platform/health", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.text).toBe("");
  });

  it("forwards the request (Authorization) to sessionSource", async () => {
    await seed();
    const seen: string[] = [];
    const handle = createPlatformHandler({
      appConfig,
      sessionSource: (request) => {
        seen.push(request.headers.get("authorization") ?? "");
        return sourceFor(alice)();
      },
      dataApi: registry(),
      getDatabase,
    });
    await call(handle, "/api/platform/data/owned-items", {
      headers: { authorization: "Bearer preview-token" },
    });
    expect(seen).toEqual(["Bearer preview-token"]);
  });
});
