import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthSessionSource, type AuthUser } from "../src/auth/index.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";
import { defineDataApi } from "../src/data-api/index.js";
import { createPlatformHandler } from "../src/http/index.js";
import { setLogSink } from "../src/logging/index.js";
import { defineAppConfig } from "../src/runtime/app-config.js";

const alice: AuthUser = { id: "user-alice", email: "alice@example.com", name: "Alice", image: null };
const bob: AuthUser = { id: "user-bob", email: "bob@example.com", name: "Bob", image: null };

const appConfig = defineAppConfig({
  name: "http-test",
  version: "0.0.0",
  dataApiVersion: "0.5.1",
});

const resource = {
  name: "owned-items",
  relation: "owned_items",
  columns: ["id", "user_id", "value"] as const,
  ownerColumn: "user_id",
  orderBy: "id",
};

function sourceFor(user: AuthUser | null) {
  return () =>
    createAuthSessionSource({
      async getSession() {
        return user ? { user } : null;
      },
    });
}

function handlerFor(user: AuthUser | null, extra: { exportMaxRows?: number } = {}) {
  return createPlatformHandler({
    appConfig,
    sessionSource: sourceFor(user),
    getDatabase,
    dataApi: defineDataApi({ resources: [resource] }),
    exportMaxRows: extra.exportMaxRows,
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
  return { status: response.status, body, headers: response.headers, text, response };
}

async function seed(countAlice = 3) {
  await runMigrations();
  const db = await getDatabase();
  await db.query(`
    create table app.owned_items (
      id text primary key,
      user_id text not null,
      value text not null
    )
  `);
  await db.query(`
    create view api.owned_items as
    select id, user_id, value from app.owned_items
  `);
  for (let i = 1; i <= countAlice; i++) {
    await db.query(`insert into app.owned_items (id, user_id, value) values ($1,$2,$3)`, [
      `a${i}`,
      alice.id,
      `alice-${i}`,
    ]);
  }
  await db.query(`insert into app.owned_items (id, user_id, value) values ($1,$2,$3)`, [
    "b1",
    bob.id,
    "bob-secret",
  ]);
  return db;
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

describe("platform HTTP data export", () => {
  it("exports CSV for a session user with a Content-Disposition filename", async () => {
    await seed();
    await call(handlerFor(alice), "/api/platform/me");
    const { status, text, headers } = await call(
      handlerFor(alice),
      "/api/platform/data/owned-items/export?format=csv",
    );
    expect(status).toBe(200);
    expect(headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("content-disposition")).toMatch(
      /^attachment; filename="owned-items-\d{8}-\d{6}\.csv"$/,
    );
    expect(headers.get("x-export-truncated")).toBeNull();
    expect(text.startsWith("id,user_id,value\n")).toBe(true);
    expect(text).toContain("alice-1");
    expect(text).not.toContain("bob-secret");
    expect(text).not.toMatch(/postgres:\/\/|select /i);
  });

  it("exports NDJSON with an API key and lists resources on GET /data", async () => {
    await seed();
    await call(handlerFor(alice), "/api/platform/me");
    const listed = await call(handlerFor(alice), "/api/platform/data");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      resources: [{ name: "owned-items", columns: ["id", "user_id", "value"], orderBy: "id" }],
    });

    const created = await call(handlerFor(alice), "/api/platform/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ci", roles: ["member"] }),
    });
    const key = (created.body as { key: string }).key;
    const handle = createPlatformHandler({
      appConfig,
      sessionSource: sourceFor(null),
      getDatabase,
      dataApi: defineDataApi({ resources: [resource] }),
    });
    const exported = await call(handle, "/api/platform/data/owned-items/export?format=json", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/x-ndjson");
    expect(exported.headers.get("content-disposition")).toMatch(/\.ndjson"$/);
    const lines = exported.text.trim().split("\n");
    expect(lines.every((line) => JSON.parse(line).user_id === alice.id)).toBe(true);
    expect(exported.text).not.toContain("bob-secret");
  });

  it("returns 401 / 404 / 400 before the stream starts", async () => {
    await seed();
    const anon = await call(handlerFor(null), "/api/platform/data/owned-items/export?format=csv");
    expect(anon.status).toBe(401);
    const anonList = await call(handlerFor(null), "/api/platform/data");
    expect(anonList.status).toBe(401);

    await call(handlerFor(alice), "/api/platform/me");
    const missing = await call(handlerFor(alice), "/api/platform/data/nope/export?format=csv");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Resource is not available", code: "unknown_resource" });

    const bad = await call(handlerFor(alice), "/api/platform/data/owned-items/export?format=xml");
    expect(bad.status).toBe(400);
    expect((bad.body as { code: string }).code).toBe("invalid_input");
    expect(typeof bad.body).toBe("object");

    const missingFormat = await call(handlerFor(alice), "/api/platform/data/owned-items/export");
    expect(missingFormat.status).toBe(400);
    expect((missingFormat.body as { code: string }).code).toBe("invalid_input");
  });

  it("sets X-Export-Truncated when the handler cap is hit", async () => {
    const db = await seed(8);
    await call(handlerFor(alice), "/api/platform/me");
    const { status, text, headers } = await call(
      handlerFor(alice, { exportMaxRows: 3 }),
      "/api/platform/data/owned-items/export?format=csv",
    );
    expect(status).toBe(200);
    expect(headers.get("x-export-truncated")).toBe("true");
    const dataLines = text.trim().split("\n").slice(1);
    expect(dataLines).toHaveLength(3);

    const audit = await db.query<{ action: string; meta: unknown }>(
      `select action, meta from private.audit_log where action = 'data.export'`,
    );
    expect(audit.rows).toHaveLength(1);
    const meta = audit.rows[0]?.meta as {
      resource: string;
      format: string;
      rows: number;
      truncated: boolean;
      principal: { kind: string; id: string };
    };
    expect(meta).toMatchObject({
      resource: "owned-items",
      format: "csv",
      rows: 3,
      truncated: true,
      principal: { kind: "user", id: alice.id },
    });
    expect(JSON.stringify(audit.rows)).not.toContain("alice-1");
    expect(JSON.stringify(audit.rows)).not.toContain("bob-secret");
  });

  it("lets platform.export.max-rows lower the cap but not raise it", async () => {
    await seed(8);
    await call(handlerFor(alice), "/api/platform/me");
    await call(handlerFor(alice), "/api/platform/settings/platform.export.max-rows", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 2 }),
    });
    const lowered = await call(
      handlerFor(alice, { exportMaxRows: 10 }),
      "/api/platform/data/owned-items/export?format=json",
    );
    expect(lowered.status).toBe(200);
    expect(lowered.headers.get("x-export-truncated")).toBe("true");
    expect(lowered.text.trim().split("\n")).toHaveLength(2);

    await call(handlerFor(alice), "/api/platform/settings/platform.export.max-rows", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 50 }),
    });
    const raised = await call(
      handlerFor(alice, { exportMaxRows: 3 }),
      "/api/platform/data/owned-items/export?format=json",
    );
    expect(raised.headers.get("x-export-truncated")).toBe("true");
    expect(raised.text.trim().split("\n")).toHaveLength(3);
  });
});
