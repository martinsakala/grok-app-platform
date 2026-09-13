import { getInternalDatabase } from "./client.js";
import { getDatabaseEngine } from "./env.js";
import { platformMigrationsReady } from "./migrations.js";
import { assertServerOnly } from "./server-guard.js";
import type { Database, DatabaseDiagnostics } from "./types.js";
import type { InternalDatabase } from "./internal.js";

function isInternal(db: Database): db is InternalDatabase {
  return "engine" in db && "exec" in db && "transaction" in db;
}

/**
 * Safe server-side diagnostics. Never includes connection strings, hosts,
 * usernames, database names, or driver error text.
 */
export async function getDatabaseDiagnostics(
  database?: Database,
): Promise<DatabaseDiagnostics> {
  assertServerOnly();
  const engine = getDatabaseEngine();
  try {
    const db = database ?? (await getInternalDatabase());
    await db.query("select 1 as ok");
    const ready = isInternal(db) ? await platformMigrationsReady(db) : false;
    return { engine, connected: true, migrationsReady: ready };
  } catch {
    return { engine, connected: false, migrationsReady: false };
  }
}
