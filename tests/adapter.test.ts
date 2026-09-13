import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDatabase,
  resetDatabaseForTests,
  runMigrations,
  setPgliteFactory,
} from "../src/database/index.js";
import { getAuthDiagnostics } from "../src/auth/index.js";

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  setPgliteFactory(undefined);
  await resetDatabaseForTests();
});

afterEach(async () => {
  await resetDatabaseForTests();
  setPgliteFactory(undefined);
  delete process.env.DATABASE_URL;
});

describe("setPgliteFactory", () => {
  it("shares one PGlite: writes via the raw instance are visible to getDatabase and back", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    setPgliteFactory(() => pg);

    await runMigrations();
    const db = await getDatabase();

    await pg.exec(`
      create table if not exists app.adapter_probe (
        id integer primary key,
        name text not null
      );
    `);
    await pg.query("insert into app.adapter_probe(id, name) values ($1, $2)", [1, "from-native"]);

    const viaPlatform = await db.query<{ id: number; name: string }>(
      "select id, name from app.adapter_probe where id = $1",
      [1],
    );
    expect(viaPlatform.rows).toEqual([{ id: 1, name: "from-native" }]);

    await db.query("insert into app.adapter_probe(id, name) values ($1, $2)", [2, "from-platform"]);
    const viaNative = await pg.query<{ id: number; name: string }>(
      "select id, name from app.adapter_probe order by id",
    );
    expect(viaNative.rows.map((row) => row.name)).toEqual(["from-native", "from-platform"]);

    await resetDatabaseForTests();
    const stillThere = await pg.query<{ name: string }>(
      "select name from app.adapter_probe where id = $1",
      [1],
    );
    expect(stillThere.rows[0]?.name).toBe("from-native");

    await pg.close();
  });

  it("keeps per-file migration transactions on an adopted PGlite", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    setPgliteFactory(() => pg);

    await runMigrations();
    await expect(
      runMigrations({
        applicationMigrations: [
          { filename: "0001_ok.sql", sql: "create table app.adapter_ok (id integer);" },
          { filename: "0002_bad.sql", sql: "create table app.adapter_missing_syntax (;);" },
        ],
      }),
    ).rejects.toThrow();

    const db = await getDatabase();
    const history = await db.query<{ filename: string }>(
      "select filename from private.application_migrations order by filename",
    );
    expect(history.rows.map((row) => row.filename)).toEqual(["0001_ok.sql"]);
    const ok = await pg.query<{ exists: boolean }>(
      "select to_regclass('app.adapter_ok') is not null as exists",
    );
    expect(ok.rows[0]?.exists).toBe(true);
    const bad = await pg.query<{ exists: boolean }>(
      "select to_regclass('app.adapter_missing_syntax') is not null as exists",
    );
    expect(bad.rows[0]?.exists).toBe(false);

    await pg.close();
  });

  it("reports auth schemaReady on the adopted instance, not a second PGlite", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    setPgliteFactory(() => pg);

    expect(await getAuthDiagnostics()).toEqual({ schemaReady: false });
    await runMigrations();
    expect(await getAuthDiagnostics()).toEqual({ schemaReady: true });

    const native = await pg.query<{ exists: boolean }>(
      "select to_regclass('public.user') is not null as exists",
    );
    expect(native.rows[0]?.exists).toBe(true);

    await pg.close();
  });
});
