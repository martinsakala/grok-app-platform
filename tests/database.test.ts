import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getDatabase,
  getDatabaseDiagnostics,
  getDatabaseEngine,
  resetDatabaseForTests,
} from "../src/database/index.js";

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  await resetDatabaseForTests();
});

afterEach(async () => {
  await resetDatabaseForTests();
  delete process.env.DATABASE_URL;
});

describe("engine selection", () => {
  it("uses PGlite when DATABASE_URL is unset", () => {
    expect(getDatabaseEngine()).toBe("pglite");
  });

  it("treats whitespace DATABASE_URL as unset", () => {
    process.env.DATABASE_URL = "   ";
    expect(getDatabaseEngine()).toBe("pglite");
  });

  it("selects postgresql when DATABASE_URL is set (no live connection)", () => {
    process.env.DATABASE_URL = "postgres://example.invalid/db";
    expect(getDatabaseEngine()).toBe("postgresql");
  });
});

describe("PGlite database API", () => {
  it("runs SELECT 1", async () => {
    const db = await getDatabase();
    const result = await db.query("select 1 as n");
    expect(result.rows).toHaveLength(1);
    expect(Number(Object.values(result.rows[0])[0])).toBe(1);
    expect(result.rowCount).toBe(1);
  });

  it("runs a parameterized SELECT", async () => {
    const db = await getDatabase();
    const result = await db.query<{ n: number }>("select $1::int as n", [42]);
    expect(result.rows[0]?.n).toBe(42);
    expect(result.rowCount).toBe(1);
  });

  it("propagates query errors", async () => {
    const db = await getDatabase();
    await expect(db.query("select definitely_missing_column from pg_catalog.pg_class")).rejects.toThrow();
  });

  it("reports connected diagnostics before migrations", async () => {
    const diagnostics = await getDatabaseDiagnostics();
    expect(diagnostics.engine).toBe("pglite");
    expect(diagnostics.connected).toBe(true);
    expect(diagnostics.migrationsReady).toBe(false);
    expect(JSON.stringify(diagnostics)).not.toMatch(/postgres:\/\//);
  });
});
