import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthSessionSource, type AuthUser } from "../src/auth/index.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";
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

function sourceFor(user: AuthUser | null) {
  return () =>
    createAuthSessionSource({
      async getSession() {
        return user ? { user } : null;
      },
    });
}

function handlerFor(user: AuthUser | null) {
  return createPlatformHandler({
    appConfig,
    sessionSource: sourceFor(user),
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
  await runMigrations();
});

afterEach(async () => {
  setLogSink(null);
  await resetDatabaseForTests();
});

describe("platform HTTP access", () => {
  it("returns 405 for a known path with the wrong method", async () => {
    const { status, body, headers } = await call(handlerFor(null), "/api/platform/health", {
      method: "POST",
    });
    expect(status).toBe(405);
    expect(body).toEqual({ error: "Method Not Allowed" });
    expect(headers.get("allow")).toMatch(/GET/);
  });

  it("returns 400 for invalid JSON on POST /api-keys", async () => {
    await call(handlerFor(alice), "/api/platform/me");
    const { status, body } = await call(handlerFor(alice), "/api/platform/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    expect(status).toBe(400);
    expect((body as { code: string }).code).toBe("bad_request");
  });

  it("GET /me has no secrets and 403s member on owner policy", async () => {
    const me = await call(handlerFor(alice), "/api/platform/me");
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      kind: "user",
      user: { id: alice.id, email: alice.email, name: alice.name },
      roles: ["owner"],
    });
    expect(me.text).not.toMatch(/token|password|hash|gk_/i);

    await call(handlerFor(bob), "/api/platform/me");
    const denied = await call(handlerFor(bob), "/api/platform/admin/access-policy");
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "Forbidden", code: "forbidden" });
  });

  it("creates an API key over HTTP and authenticates with it", async () => {
    await call(handlerFor(alice), "/api/platform/me");
    const created = await call(handlerFor(alice), "/api/platform/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ci", roles: ["member"] }),
    });
    expect(created.status).toBe(201);
    const key = (created.body as { key: string }).key;
    expect(key.startsWith("gk_")).toBe(true);

    const handle = createPlatformHandler({
      appConfig,
      sessionSource: sourceFor(null),
      getDatabase,
    });
    const me = await call(handle, "/api/platform/me", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(me.status).toBe(200);
    expect((me.body as { kind: string }).kind).toBe("api-key");
    expect(JSON.stringify(me.body)).not.toMatch(/hash|token|password/i);
  });

  it("enforces settings and audit HTTP authz (401/403)", async () => {
    const anon = await call(handlerFor(null), "/api/platform/settings");
    expect(anon.status).toBe(401);
    const anonAudit = await call(handlerFor(null), "/api/platform/admin/audit");
    expect(anonAudit.status).toBe(401);

    await call(handlerFor(alice), "/api/platform/me");
    await call(handlerFor(bob), "/api/platform/me");

    const memberWrite = await call(handlerFor(bob), "/api/platform/settings/app.theme", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: { color: "dark" } }),
    });
    expect(memberWrite.status).toBe(403);

    const memberAudit = await call(handlerFor(bob), "/api/platform/admin/audit");
    expect(memberAudit.status).toBe(403);

    const written = await call(handlerFor(alice), "/api/platform/settings/app.theme", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: { color: "dark" } }),
    });
    expect(written.status).toBe(200);
    expect((written.body as { value: { color: string } }).value).toEqual({ color: "dark" });

    const read = await call(handlerFor(bob), "/api/platform/settings/app.theme");
    expect(read.status).toBe(200);

    const missing = await call(handlerFor(alice), "/api/platform/settings/nope.missing");
    expect(missing.status).toBe(404);

    const badKey = await call(handlerFor(alice), "/api/platform/settings/Not_Valid", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 1 }),
    });
    expect(badKey.status).toBe(400);

    const audit = await call(handlerFor(alice), "/api/platform/admin/audit?limit=10&action=settings.set");
    expect(audit.status).toBe(200);
    const entries = (audit.body as { entries: { action: string }[] }).entries;
    expect(entries.some((row) => row.action === "settings.set")).toBe(true);
    expect(JSON.stringify(audit.body)).not.toMatch(/gk_/);
  });
});
