import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDatabase,
  getDatabaseDiagnostics,
  resetDatabaseForTests,
  runMigrations,
} from "../src/database/index.js";

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  await resetDatabaseForTests();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe("platform migrations", () => {
  it("creates private/app/api schemas and platform history on a fresh DB", async () => {
    await runMigrations();
    const db = await getDatabase();

    const schemas = await db.query<{ nspname: string }>(
      `select nspname from pg_catalog.pg_namespace
       where nspname in ('private', 'app', 'api')
       order by nspname`,
    );
    expect(schemas.rows.map((row) => row.nspname)).toEqual(["api", "app", "private"]);

    const history = await db.query<{ filename: string }>(
      "select filename from private.platform_migrations order by filename",
    );
    expect(history.rows.map((row) => row.filename)).toEqual(["0001_init.sql", "0002_auth.sql"]);

    const diagnostics = await getDatabaseDiagnostics();
    expect(diagnostics).toEqual({
      engine: "pglite",
      connected: true,
      migrationsReady: true,
    });
  });

  it("does not re-apply an already recorded platform migration", async () => {
    await runMigrations();
    await runMigrations();
    const db = await getDatabase();
    const history = await db.query<{ filename: string }>(
      "select filename from private.platform_migrations",
    );
    expect(history.rows).toHaveLength(2);
  });

  it("fails when an applied migration checksum changes", async () => {
    await runMigrations();
    await expect(
      runMigrations({
        applicationMigrations: [{ filename: "0001_once.sql", sql: "select 1;" }],
      }),
    ).resolves.toBeUndefined();

    await expect(
      runMigrations({
        applicationMigrations: [{ filename: "0001_once.sql", sql: "select 2;" }],
      }),
    ).rejects.toThrow(/checksum mismatch/);
  });
});

describe("application and API migrations", () => {
  it("keeps application and API histories separate and ordered", async () => {
    await runMigrations({
      applicationMigrations: [
        {
          filename: "0002_second.sql",
          sql: "insert into app.migration_order(id) values (2);",
        },
        {
          filename: "0001_first.sql",
          sql: "create table app.migration_order (id integer primary key); insert into app.migration_order(id) values (1);",
        },
      ],
      apiMigrations: [
        {
          filename: "0001_order_view.sql",
          sql: "create view api.migration_order as select id from app.migration_order;",
        },
      ],
    });

    const db = await getDatabase();
    const appHistory = await db.query<{ filename: string }>(
      "select filename from private.application_migrations order by filename",
    );
    const apiHistory = await db.query<{ filename: string }>(
      "select filename from private.api_migrations order by filename",
    );
    expect(appHistory.rows.map((row) => row.filename)).toEqual([
      "0001_first.sql",
      "0002_second.sql",
    ]);
    expect(apiHistory.rows.map((row) => row.filename)).toEqual(["0001_order_view.sql"]);

    const ids = await db.query<{ id: number }>("select id from api.migration_order order by id");
    expect(ids.rows.map((row) => row.id)).toEqual([1, 2]);
  });

  it("commits earlier files and rolls back only the failed migration file", async () => {
    await runMigrations();
    await expect(
      runMigrations({
        applicationMigrations: [
          { filename: "0001_ok.sql", sql: "create table app.ok (id integer);" },
          { filename: "0002_bad.sql", sql: "create table app.missing_syntax (;);" },
        ],
      }),
    ).rejects.toThrow();

    const db = await getDatabase();
    const appHistory = await db.query<{ filename: string }>(
      "select filename from private.application_migrations order by filename",
    );
    expect(appHistory.rows.map((row) => row.filename)).toEqual(["0001_ok.sql"]);

    const ok = await db.query<{ exists: boolean }>(
      "select to_regclass('app.ok') is not null as exists",
    );
    expect(ok.rows[0]?.exists).toBe(true);

    const bad = await db.query<{ exists: boolean }>(
      "select to_regclass('app.missing_syntax') is not null as exists",
    );
    expect(bad.rows[0]?.exists).toBe(false);
  });

  it("rolls back only the failed file, skips later files, and resumes from the first unapplied migration", async () => {
    await runMigrations();

    const m1 = {
      filename: "0001_ok.sql",
      sql: "create table app.one (id integer primary key); insert into app.one(id) values (1);",
    };
    const m2Fail = {
      filename: "0002_partial.sql",
      sql: "create table app.two (id integer primary key); insert into app.two(id) values (1); insert into app.two_does_not_exist(id) values (1);",
    };
    const m2Ok = {
      filename: "0002_partial.sql",
      sql: "create table app.two (id integer primary key); insert into app.two(id) values (1);",
    };
    const m3 = {
      filename: "0003_later.sql",
      sql: "create table app.three (id integer primary key); insert into app.three(id) values (3);",
    };

    await expect(
      runMigrations({ applicationMigrations: [m1, m2Fail, m3] }),
    ).rejects.toThrow();

    const db = await getDatabase();

    const history = await db.query<{ filename: string }>(
      "select filename from private.application_migrations order by filename",
    );
    expect(history.rows.map((row) => row.filename)).toEqual(["0001_ok.sql"]);

    const one = await db.query<{ exists: boolean }>(
      "select to_regclass('app.one') is not null as exists",
    );
    expect(one.rows[0]?.exists).toBe(true);
    const oneRows = await db.query<{ id: number }>("select id from app.one");
    expect(oneRows.rows.map((row) => row.id)).toEqual([1]);

    const two = await db.query<{ exists: boolean }>(
      "select to_regclass('app.two') is not null as exists",
    );
    expect(two.rows[0]?.exists).toBe(false);

    const three = await db.query<{ exists: boolean }>(
      "select to_regclass('app.three') is not null as exists",
    );
    expect(three.rows[0]?.exists).toBe(false);

    await expect(
      runMigrations({ applicationMigrations: [m1, m2Fail, m3] }),
    ).rejects.toThrow();

    const historyRetry = await db.query<{ filename: string }>(
      "select filename from private.application_migrations order by filename",
    );
    expect(historyRetry.rows.map((row) => row.filename)).toEqual(["0001_ok.sql"]);
    const threeRetry = await db.query<{ exists: boolean }>(
      "select to_regclass('app.three') is not null as exists",
    );
    expect(threeRetry.rows[0]?.exists).toBe(false);

    await runMigrations({ applicationMigrations: [m1, m2Ok, m3] });

    const historyAfter = await db.query<{ filename: string }>(
      "select filename from private.application_migrations order by filename",
    );
    expect(historyAfter.rows.map((row) => row.filename)).toEqual([
      "0001_ok.sql",
      "0002_partial.sql",
      "0003_later.sql",
    ]);

    expect((await db.query<{ id: number }>("select id from app.one")).rows.map((row) => row.id)).toEqual([
      1,
    ]);
    expect((await db.query<{ id: number }>("select id from app.two")).rows.map((row) => row.id)).toEqual([
      1,
    ]);
    expect(
      (await db.query<{ id: number }>("select id from app.three")).rows.map((row) => row.id),
    ).toEqual([3]);
  });
});

describe("PostgreSQL lock protocol", () => {
  it("uses session-level pg_advisory_lock, not a transaction-scoped lock", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/database/migrations.ts", import.meta.url)), "utf8");
    expect(src).toMatch(/select pg_advisory_lock\(\$1\)/);
    expect(src).toMatch(/select pg_advisory_unlock\(\$1\)/);
    expect(src).not.toMatch(/select pg_advisory_xact_lock/);
    expect(src).toMatch(/resolveMigrationConnectionString/);
  });
});
