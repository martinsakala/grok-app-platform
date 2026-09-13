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
    expect(history.rows.map((row) => row.filename)).toEqual(["0001_init.sql"]);

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
    expect(history.rows).toHaveLength(1);
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

  it("rolls back a failed application migration without recording it", async () => {
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
      "select filename from private.application_migrations",
    );
    expect(appHistory.rows).toHaveLength(0);

    const exists = await db.query<{ exists: boolean }>(
      "select to_regclass('app.ok') is not null as exists",
    );
    expect(exists.rows[0]?.exists).toBe(false);
  });
});
