import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthSessionSource, type AuthUser } from "../src/auth/index.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";
import { createPlatformHandler } from "../src/http/index.js";
import { setLogSink } from "../src/logging/index.js";
import { MutationError, defineMutations, hashMutationInput, mutationOwnerId } from "../src/mutations/index.js";
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

function mutations() {
  return defineMutations({
    mutations: [
      {
        name: "create-note",
        description: "Create a note owned by the caller",
        input: {
          fields: {
            text: { type: "string", required: true, maxLength: 200 },
            user_id: { type: "string" },
          },
        },
        roles: ["member"],
        handler: async (ctx) => {
          const owner = mutationOwnerId(ctx.principal);
          const inserted = await ctx.db.query<{ id: string }>(
            `insert into app.notes (id, user_id, text)
             values ($1, $2, $3)
             returning id`,
            [crypto.randomUUID(), owner, String(ctx.input.text)],
          );
          return { id: inserted.rows[0]?.id, owner };
        },
      },
      {
        name: "boom-note",
        description: "Insert then throw",
        input: { fields: { text: { type: "string", required: true } } },
        roles: ["member"],
        handler: async (ctx) => {
          await ctx.db.query(
            `insert into app.notes (id, user_id, text) values ($1, $2, $3)`,
            ["boom", mutationOwnerId(ctx.principal), String(ctx.input.text)],
          );
          throw new Error("handler boom relation app.notes postgres://u:p@h/db");
        },
      },
      {
        name: "owner-ping",
        description: "Owner only",
        input: { fields: {} },
        roles: ["owner"],
        handler: async () => ({ pong: true }),
      },
      {
        name: "conflict-note",
        description: "Always conflict",
        input: { fields: {} },
        roles: ["member"],
        handler: async () => {
          throw new MutationError("conflict");
        },
      },
    ],
  });
}

function handlerFor(user: AuthUser | null) {
  return createPlatformHandler({
    appConfig,
    sessionSource: sourceFor(user),
    getDatabase,
    mutations: mutations(),
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

async function seed() {
  await runMigrations();
  const db = await getDatabase();
  await db.query(`
    create table app.notes (
      id text primary key,
      user_id text not null,
      text text not null
    )
  `);
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

describe("platform HTTP mutations", () => {
  it("runs a mutation for a session user and ignores client user_id", async () => {
    const db = await seed();
    await call(handlerFor(alice), "/api/platform/me");
    const { status, body, text } = await call(handlerFor(alice), "/api/platform/mutations/create-note", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-1" },
      body: JSON.stringify({ text: "hello", user_id: bob.id }),
    });
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    const result = (body as { result: { owner: string } }).result;
    expect(result.owner).toBe(alice.id);
    expect(text).not.toMatch(/postgres:\/\/|password|gk_/i);
    const rows = await db.query<{ user_id: string }>("select user_id from app.notes");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.user_id).toBe(alice.id);
    expect(rows.rows.some((row) => row.user_id === bob.id)).toBe(false);
  });

  it("runs a mutation with an API key", async () => {
    await seed();
    await call(handlerFor(alice), "/api/platform/me");
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
      mutations: mutations(),
    });
    const ran = await call(handle, "/api/platform/mutations/create-note", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "from-key" }),
    });
    expect(ran.status).toBe(200);
    expect((ran.body as { result: { owner: string } }).result.owner).toBe(alice.id);
  });

  it("returns 401 / 403 / 404 as specified", async () => {
    await seed();
    const anon = await call(handlerFor(null), "/api/platform/mutations/create-note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "x" }),
    });
    expect(anon.status).toBe(401);

    await call(handlerFor(alice), "/api/platform/me");
    await call(handlerFor(bob), "/api/platform/me");

    const forbidden = await call(handlerFor(bob), "/api/platform/mutations/owner-ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ error: "Forbidden", code: "forbidden" });

    const missing = await call(handlerFor(alice), "/api/platform/mutations/no-such", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Mutation is not available", code: "unknown_mutation" });

    const listed = await call(handlerFor(bob), "/api/platform/mutations");
    expect(listed.status).toBe(200);
    const names = (listed.body as { mutations: { name: string }[] }).mutations.map((row) => row.name);
    expect(names).toContain("create-note");
    expect(names).not.toContain("owner-ping");
  });

  it("returns 400 invalid_input with paths", async () => {
    await seed();
    await call(handlerFor(alice), "/api/platform/me");
    const { status, body } = await call(handlerFor(alice), "/api/platform/mutations/create-note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ extra: true }),
    });
    expect(status).toBe(400);
    expect((body as { code: string }).code).toBe("invalid_input");
    const errors = (body as { errors: { path: string }[] }).errors;
    expect(errors.some((item) => item.path === "extra")).toBe(true);
    expect(errors.some((item) => item.path === "text")).toBe(true);
  });

  it("rolls back the handler transaction on failure", async () => {
    const db = await seed();
    await call(handlerFor(alice), "/api/platform/me");
    const { status, body, text } = await call(handlerFor(alice), "/api/platform/mutations/boom-note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "nope" }),
    });
    expect(status).toBe(500);
    expect(body).toEqual({ error: "Mutation failed", code: "mutation_failed" });
    expect(text).not.toMatch(/handler boom|postgres:\/\/|app\.notes/i);
    const rows = await db.query<{ n: number }>("select count(*)::int as n from app.notes");
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("replays an idempotent success and rejects a mismatched body", async () => {
    const db = await seed();
    await call(handlerFor(alice), "/api/platform/me");
    const first = await call(handlerFor(alice), "/api/platform/mutations/create-note", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "k1",
      },
      body: JSON.stringify({ text: "once" }),
    });
    expect(first.status).toBe(200);
    const id = (first.body as { result: { id: string } }).result.id;
    const replay = await call(handlerFor(alice), "/api/platform/mutations/create-note", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "k1",
      },
      body: JSON.stringify({ text: "once" }),
    });
    expect(replay.status).toBe(200);
    expect((replay.body as { result: { id: string } }).result.id).toBe(id);
    const count = await db.query<{ n: number }>("select count(*)::int as n from app.notes");
    expect(count.rows[0]?.n).toBe(1);

    const mismatch = await call(handlerFor(alice), "/api/platform/mutations/create-note", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "k1",
      },
      body: JSON.stringify({ text: "other" }),
    });
    expect(mismatch.status).toBe(409);
    expect((mismatch.body as { code: string }).code).toBe("idempotency_mismatch");
  });

  it("returns 409 conflict from MutationError and writes audit without payload", async () => {
    const db = await seed();
    await call(handlerFor(alice), "/api/platform/me");
    const conflicted = await call(handlerFor(alice), "/api/platform/mutations/conflict-note", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-audit" },
      body: "{}",
    });
    expect(conflicted.status).toBe(409);
    expect(conflicted.body).toEqual({ error: "Conflict", code: "conflict" });

    await call(handlerFor(alice), "/api/platform/mutations/create-note", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-ok" },
      body: JSON.stringify({ text: "audited" }),
    });

    const audit = await db.query<{ action: string; meta: unknown }>(
      `select action, meta from private.audit_log where action like 'mutation.%' order by id`,
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toContain("mutation.create-note");
    expect(actions).toContain("mutation.conflict-note");
    const ok = audit.rows.find((row) => row.action === "mutation.create-note");
    const meta = ok?.meta as { outcome: string; inputSha256: string; requestId: string };
    expect(meta.outcome).toBe("ok");
    expect(meta.requestId).toBe("req-ok");
    expect(meta.inputSha256).toBe(hashMutationInput({ text: "audited" }));
    expect(JSON.stringify(audit.rows)).not.toMatch(/audited|hello|payload|postgres:\/\//i);
  });
});
