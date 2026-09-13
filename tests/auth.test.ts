import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_RELATIONS_EXCLUDED_FROM_DATA_API,
  assignOwner,
  assertNoSecrets,
  authUserKeys,
  createAuthSessionSource,
  getAuthDiagnostics,
  getCurrentSession,
  getCurrentUser,
  isExcludedFromDataApi,
  ownerIdFromSession,
  requireUser,
  toAuthUser,
  UnauthorizedError,
} from "../src/auth/index.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";

function sourceWith(user: unknown) {
  return createAuthSessionSource({
    getSessionUser: async () => user,
    getSession: async () =>
      user
        ? {
            user,
            session: {
              id: "sess-1",
              expiresAt: "2026-12-01T00:00:00.000Z",
              token: "session-token-must-not-leak",
              userId: (user as { id?: string }).id,
            },
          }
        : null,
  });
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  await resetDatabaseForTests();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe("auth config", () => {
  it("exposes only the stable AuthUser keys", () => {
    expect(authUserKeys()).toEqual(["id", "email", "name", "image"]);
  });

  it("excludes Better Auth public tables from a future data API", () => {
    expect(AUTH_RELATIONS_EXCLUDED_FROM_DATA_API).toEqual([
      'public."user"',
      'public."session"',
      'public."account"',
      'public."verification"',
    ]);
    expect(isExcludedFromDataApi("public.user")).toBe(true);
    expect(isExcludedFromDataApi('public."session"')).toBe(true);
    expect(isExcludedFromDataApi("app.auth_test_items")).toBe(false);
    expect(isExcludedFromDataApi("private.platform_migrations")).toBe(false);
  });
});

describe("toAuthUser", () => {
  it("maps a Better Auth user and drops internals", () => {
    const user = toAuthUser({
      id: "user-1",
      name: "Ada",
      email: "ada@example.com",
      emailVerified: true,
      image: "https://example.com/ada.png",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
      accessToken: "access-token-secret",
      refreshToken: "refresh-token-secret",
      password: "hashed-password",
      role: "admin",
    });
    expect(user).toEqual({
      id: "user-1",
      email: "ada@example.com",
      name: "Ada",
      image: "https://example.com/ada.png",
    });
    expect(JSON.stringify(user)).not.toMatch(/token|password|secret|admin|emailVerified/i);
    assertNoSecrets(user);
  });

  it("reads nested Better Auth { user, session } and ignores the session token", () => {
    const user = toAuthUser({
      session: {
        token: "cookie-session-token",
        expiresAt: "2026-12-01T00:00:00.000Z",
      },
      user: { id: "nested", email: "n@example.com", name: "N", image: null },
    });
    expect(user).toEqual({
      id: "nested",
      email: "n@example.com",
      name: "N",
      image: null,
    });
  });

  it("returns null without an id", () => {
    expect(toAuthUser(null)).toBeNull();
    expect(toAuthUser({ email: "x@y.z" })).toBeNull();
    expect(toAuthUser({ id: "   " })).toBeNull();
  });
});

describe("session helpers", () => {
  it("getCurrentUser returns null without a session", async () => {
    await expect(getCurrentUser(sourceWith(null))).resolves.toBeNull();
  });

  it("requireUser throws Unauthorized without a session", async () => {
    await expect(requireUser(sourceWith(null))).rejects.toSatisfy((error: unknown) => {
      return error instanceof UnauthorizedError && error.status === 401 && error.message === "Unauthorized";
    });
  });

  it("maps a mocked session to AuthUser", async () => {
    const source = sourceWith({
      id: "real-user",
      email: "real@example.com",
      name: "Real",
      image: null,
      accessToken: "must-not-leak",
    });
    await expect(getCurrentUser(source)).resolves.toEqual({
      id: "real-user",
      email: "real@example.com",
      name: "Real",
      image: null,
    });
    await expect(requireUser(source)).resolves.toEqual({
      id: "real-user",
      email: "real@example.com",
      name: "Real",
      image: null,
    });
  });

  it("getCurrentSession never includes the session token", async () => {
    const session = await getCurrentSession(
      sourceWith({ id: "real-user", email: "real@example.com", name: "Real", image: null }),
    );
    expect(session).toEqual({
      user: { id: "real-user", email: "real@example.com", name: "Real", image: null },
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    expect(JSON.stringify(session)).not.toMatch(/session-token|accessToken|token/i);
    assertNoSecrets(session);
  });

  it("does not accept or honor a client-supplied user id as identity", async () => {
    const source = sourceWith({ id: "session-user", email: "s@example.com", name: "S", image: null });
    const user = await requireUser(source);
    expect(user.id).toBe("session-user");
    expect(ownerIdFromSession(user, { user_id: "attacker" })).toBe("session-user");
    expect(assignOwner(user, { value: "hello", user_id: "attacker" })).toEqual({
      value: "hello",
      user_id: "session-user",
    });
  });
});

describe("per-user isolation", () => {
  it("assigns rows to the session user and hides other users' rows even if the client sends user_id", async () => {
    await runMigrations();
    const db = await getDatabase();
    await db.query(`
      create table app.auth_isolation (
        id text primary key,
        user_id text not null,
        value text not null
      )
    `);

    const alice = await requireUser(
      sourceWith({ id: "alice", email: "alice@example.com", name: "Alice", image: null }),
    );
    const bob = await requireUser(
      sourceWith({ id: "bob", email: "bob@example.com", name: "Bob", image: null }),
    );

    const aliceRow = assignOwner(alice, { id: "r1", value: "alice-secret", user_id: "bob" });
    const bobRow = assignOwner(bob, { id: "r2", value: "bob-secret", user_id: "alice" });
    expect(aliceRow.user_id).toBe("alice");
    expect(bobRow.user_id).toBe("bob");

    await db.query("insert into app.auth_isolation (id, user_id, value) values ($1, $2, $3)", [
      aliceRow.id,
      aliceRow.user_id,
      aliceRow.value,
    ]);
    await db.query("insert into app.auth_isolation (id, user_id, value) values ($1, $2, $3)", [
      bobRow.id,
      bobRow.user_id,
      bobRow.value,
    ]);

    const aliceRows = await db.query<{ id: string; user_id: string; value: string }>(
      "select id, user_id, value from app.auth_isolation where user_id = $1",
      [ownerIdFromSession(alice, { user_id: "bob" })],
    );
    expect(aliceRows.rows).toEqual([{ id: "r1", user_id: "alice", value: "alice-secret" }]);

    const bobRows = await db.query<{ id: string; value: string }>(
      "select id, value from app.auth_isolation where user_id = $1",
      [ownerIdFromSession(bob)],
    );
    expect(bobRows.rows.map((row) => row.id)).toEqual(["r2"]);
  });
});

describe("auth migrations", () => {
  it("creates Better Auth public tables on PGlite", async () => {
    await runMigrations();
    const db = await getDatabase();
    const tables = await db.query<{ relname: string }>(
      `select c.relname
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('user', 'session', 'account', 'verification')
          and c.relkind = 'r'
        order by c.relname`,
    );
    expect(tables.rows.map((row) => row.relname)).toEqual([
      "account",
      "session",
      "user",
      "verification",
    ]);

    await db.query(`select "emailVerified", "image" from "user" limit 0`);
    await db.query(`select "accessToken", "refreshToken", "password" from "account" limit 0`);
    await db.query(`select "token", "userId" from "session" limit 0`);

    const history = await db.query<{ filename: string }>(
      "select filename from private.platform_migrations order by filename",
    );
    expect(history.rows.map((row) => row.filename)).toEqual(["0001_init.sql", "0002_auth.sql"]);
  });
});

describe("getAuthDiagnostics", () => {
  it("reports schemaReady after migrations and never includes secrets", async () => {
    const before = await getAuthDiagnostics();
    expect(before).toEqual({ schemaReady: false });

    await runMigrations();
    const after = await getAuthDiagnostics();
    expect(after).toEqual({ schemaReady: true });
    expect(JSON.stringify(after)).not.toMatch(
      /token|secret|password|GOOGLE|GROK_AUTH|BETTER_AUTH|postgres:\/\//i,
    );
    assertNoSecrets(after);
  });

  it("does not treat an unsigned-in visitor as a failure", async () => {
    await runMigrations();
    const diagnostics = await getAuthDiagnostics();
    expect(diagnostics.schemaReady).toBe(true);
    expect(diagnostics).not.toHaveProperty("user");
    expect(diagnostics).not.toHaveProperty("signedIn");
  });
});
