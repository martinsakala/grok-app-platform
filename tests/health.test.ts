import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getHealthResponse } from "../src/runtime/health.js";
import { getPlatformVersion } from "../src/runtime/platform-version.js";
import {
  resetDatabaseForTests,
  runMigrations,
  type Database,
} from "../src/database/index.js";

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  await resetDatabaseForTests();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe("getHealthResponse", () => {
  it("returns ok for a migrated PGlite database", async () => {
    await runMigrations();
    const response = await getHealthResponse();
    expect(response).toEqual({
      status: "ok",
      platformVersion: getPlatformVersion(),
      database: { status: "ok", engine: "pglite" },
    });
  });

  it("returns degraded without leaking driver details on DB error", async () => {
    const failing: Database = {
      query: async () => {
        throw new Error("ECONNREFUSED postgres://secret-user:secret-pass@hidden-host:5432/hidden-db");
      },
      close: async () => undefined,
    };
    const response = await getHealthResponse(failing);
    expect(response.status).toBe("degraded");
    expect(response.database).toEqual({ status: "error", engine: "pglite" });
    expect(JSON.stringify(response)).not.toMatch(
      /secret-user|secret-pass|hidden-host|hidden-db|postgres:\/\//,
    );
  });
});
