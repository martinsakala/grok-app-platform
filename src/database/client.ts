import { assertServerOnly } from "./server-guard.js";
import { getDatabaseEngine, readDatabaseUrl } from "./env.js";
import type { InternalDatabase } from "./internal.js";
import type { Database, DatabaseEngine } from "./types.js";

const globalRef = globalThis as typeof globalThis & {
  __grokPlatformDb__?: Promise<InternalDatabase>;
};

async function openDatabase(): Promise<InternalDatabase> {
  assertServerOnly();
  const url = readDatabaseUrl();
  if (url) {
    const { createPostgresDatabase } = await import("./postgres.js");
    return createPostgresDatabase(url);
  }
  const { createPgliteDatabase } = await import("./pglite.js");
  return createPgliteDatabase();
}

export function getDatabaseEngineName(): DatabaseEngine {
  return getDatabaseEngine();
}

/**
 * Lazy process-wide singleton. PGlite is in-memory and ephemeral across
 * preview restarts; PostgreSQL is used when DATABASE_URL is set.
 */
export function getDatabase(): Promise<Database> {
  return getInternalDatabase();
}

export function getInternalDatabase(): Promise<InternalDatabase> {
  globalRef.__grokPlatformDb__ ??= openDatabase().catch((error) => {
    globalRef.__grokPlatformDb__ = undefined;
    throw error;
  });
  return globalRef.__grokPlatformDb__;
}

/** Test helper: close the singleton so the next getDatabase() opens a fresh engine. */
export async function resetDatabaseForTests(): Promise<void> {
  const pending = globalRef.__grokPlatformDb__;
  globalRef.__grokPlatformDb__ = undefined;
  const migrateRef = globalThis as typeof globalThis & {
    __grokPlatformMigrateChain__?: Promise<void>;
  };
  migrateRef.__grokPlatformMigrateChain__ = undefined;
  if (!pending) return;
  try {
    const db = await pending;
    await db.close();
  } catch {
    // ignore failed init
  }
}
