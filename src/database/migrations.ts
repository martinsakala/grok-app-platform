import { PLATFORM_MIGRATIONS } from "./generated/platform-migrations.js";
import { getInternalDatabase } from "./client.js";
import { migrationChecksum } from "./checksum.js";
import { assertServerOnly } from "./server-guard.js";
import type { InternalDatabase, Tx } from "./internal.js";
import type { MigrationKind, MigrationSource, RunMigrationsOptions } from "./types.js";

const HISTORY_TABLE: Record<MigrationKind, string> = {
  platform: "private.platform_migrations",
  application: "private.application_migrations",
  api: "private.api_migrations",
};

/** Stable advisory-lock key for production migration runs (`grk1`). */
const MIGRATION_LOCK_KEY = 0x67726b31;

const FILENAME_PATTERN = /^\d{4}_[A-Za-z0-9._-]+\.sql$/;

type Queryable = Pick<Tx, "query">;

export function sortMigrations(migrations: readonly MigrationSource[]): MigrationSource[] {
  return [...migrations].sort((a, b) =>
    a.filename.localeCompare(b.filename, "en", { numeric: true, sensitivity: "base" }),
  );
}

export function defineMigrations(
  migrations: readonly MigrationSource[],
): readonly MigrationSource[] {
  const sorted = sortMigrations(migrations);
  for (const migration of sorted) {
    assertMigrationFilename(migration.filename);
  }
  return Object.freeze(sorted);
}

function assertMigrationFilename(filename: string): void {
  if (!FILENAME_PATTERN.test(filename)) {
    throw new Error(
      `Invalid migration filename ${JSON.stringify(filename)}; expected e.g. 0001_init.sql`,
    );
  }
}

async function relationExists(tx: Queryable, qualifiedName: string): Promise<boolean> {
  const result = await tx.query<{ exists: boolean }>(
    "select to_regclass($1) is not null as exists",
    [qualifiedName],
  );
  return result.rows[0]?.exists === true;
}

async function loadApplied(tx: Queryable, kind: MigrationKind): Promise<Map<string, string>> {
  const table = HISTORY_TABLE[kind];
  if (!(await relationExists(tx, table))) {
    return new Map();
  }
  const result = await tx.query<{ filename: string; checksum: string }>(
    `select filename, checksum from ${table}`,
  );
  return new Map(result.rows.map((row) => [row.filename, row.checksum]));
}

async function applyKind(
  tx: Tx,
  kind: MigrationKind,
  migrations: readonly MigrationSource[],
): Promise<void> {
  const ordered = sortMigrations(migrations);
  const applied = await loadApplied(tx, kind);

  for (const migration of ordered) {
    assertMigrationFilename(migration.filename);
    const checksum = migrationChecksum(migration.sql);
    const previous = applied.get(migration.filename);
    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `Migration checksum mismatch for ${kind} file ${migration.filename}. ` +
            `Historical migration files must not be edited after they have been applied; add a new file instead.`,
        );
      }
      continue;
    }

    await tx.exec(migration.sql);

    const table = HISTORY_TABLE[kind];
    if (kind === "platform" && !(await relationExists(tx, table))) {
      throw new Error(
        `Platform migration ${migration.filename} did not create ${table}; ` +
          `the first platform migration must create schemas and history tables.`,
      );
    }

    await tx.query(`insert into ${table} (filename, checksum) values ($1, $2)`, [
      migration.filename,
      checksum,
    ]);
    applied.set(migration.filename, checksum);
  }
}

async function runAll(db: InternalDatabase, options: RunMigrationsOptions = {}): Promise<void> {
  await db.transaction(async (tx) => {
    if (db.engine === "postgresql") {
      await tx.query("select pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    }
    await applyKind(tx, "platform", PLATFORM_MIGRATIONS);
    if (options.applicationMigrations) {
      await applyKind(tx, "application", options.applicationMigrations);
    }
    if (options.apiMigrations) {
      await applyKind(tx, "api", options.apiMigrations);
    }
  });
}

const migrateRef = globalThis as typeof globalThis & {
  __grokPlatformMigrateChain__?: Promise<void>;
};

function enqueue(work: () => Promise<void>): Promise<void> {
  const next = (migrateRef.__grokPlatformMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined)
    .then(work);
  migrateRef.__grokPlatformMigrateChain__ = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Apply platform migrations, then optional application and API migrations.
 * Safe to call repeatedly. Concurrent callers in one process share a queue.
 * Production PostgreSQL also takes a transaction-scoped advisory lock.
 *
 * Limits: advisory locks do not coordinate separate serverless isolates that
 * cannot see each other's sessions; hosts should still run migrations once at
 * boot. In-process queuing covers Grok preview + a single Node process.
 */
export function runMigrations(options: RunMigrationsOptions = {}): Promise<void> {
  assertServerOnly();
  return enqueue(async () => {
    const db = await getInternalDatabase();
    await runAll(db, options);
  });
}

export async function platformMigrationsReady(db: Queryable): Promise<boolean> {
  try {
    const applied = await loadApplied(db, "platform");
    if (PLATFORM_MIGRATIONS.length === 0) return false;
    return PLATFORM_MIGRATIONS.every((migration) => applied.has(migration.filename));
  } catch {
    return false;
  }
}
