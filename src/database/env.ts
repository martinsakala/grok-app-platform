import type { DatabaseEngine } from "./types.js";

/**
 * Empty / whitespace DATABASE_URL is treated as unset so a misconfigured
 * deploy UI cannot silently select PostgreSQL with an unusable string.
 *
 * This is the **query** URL (Better Auth, `getSql()`, `getDatabase()`).
 * It may be a Neon/PgBouncer transaction-pooler endpoint. The migration
 * runner does not use this string blindly — see `resolveMigrationConnectionString`.
 */
export function readDatabaseUrl(): string | undefined {
  const raw = typeof process !== "undefined" ? process.env.DATABASE_URL : undefined;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getDatabaseEngine(): DatabaseEngine {
  return readDatabaseUrl() ? "postgresql" : "pglite";
}
