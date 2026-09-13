import { PLATFORM_MIGRATIONS } from "./generated/platform-migrations.js";
import { getInternalDatabase } from "./client.js";
import { resolveMigrationConnectionString } from "./connection-url.js";
import { migrationChecksum } from "./checksum.js";
import { readDatabaseUrl } from "./env.js";
import { assertServerOnly } from "./server-guard.js";
import type { InternalDatabase, Session, Tx } from "./internal.js";
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

const testHooks = globalThis as typeof globalThis & {
  /** Test-only: runs after each committed file while the session lock is still held. */
  __grokPlatformMigrateAfterFile__?: () => Promise<void>;
};

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

/**
 * Apply one kind's files in filename order. Each unapplied file runs in its
 * own transaction together with the history insert. Checksum mismatches on
 * already-applied files abort the run before later files start.
 */
async function applyKind(
  session: Session,
  kind: MigrationKind,
  migrations: readonly MigrationSource[],
): Promise<void> {
  const ordered = sortMigrations(migrations);
  const applied = await loadApplied(session, kind);

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

    await session.transaction(async (tx) => {
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
    });
    applied.set(migration.filename, checksum);
    if (testHooks.__grokPlatformMigrateAfterFile__) {
      await testHooks.__grokPlatformMigrateAfterFile__();
    }
  }
}

async function applyAll(session: Session, options: RunMigrationsOptions): Promise<void> {
  await applyKind(session, "platform", PLATFORM_MIGRATIONS);
  if (options.applicationMigrations) {
    await applyKind(session, "application", options.applicationMigrations);
  }
  if (options.apiMigrations) {
    await applyKind(session, "api", options.apiMigrations);
  }
}

async function withMigrationLock(session: Session, options: RunMigrationsOptions): Promise<void> {
  // Session-level lock: survives each file's COMMIT. A transaction-scoped
  // lock (`pg_advisory_xact_lock`) would be released between files.
  await session.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  let applyError: unknown;
  try {
    await applyAll(session, options);
  } catch (error) {
    applyError = error;
  }
  try {
    await session.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
  } catch (unlockError) {
    if (!applyError) throw unlockError;
  }
  if (applyError) throw applyError;
}

async function runAll(queryDb: InternalDatabase, options: RunMigrationsOptions = {}): Promise<void> {
  if (queryDb.engine !== "postgresql") {
    await queryDb.withSession(async (session) => {
      await applyAll(session, options);
    });
    return;
  }

  const queryUrl = readDatabaseUrl();
  if (!queryUrl) {
    throw new Error("PostgreSQL engine selected without DATABASE_URL");
  }
  const migrationUrl = resolveMigrationConnectionString(queryUrl);
  let lockDb = queryDb;
  let owned = false;
  if (migrationUrl !== queryUrl) {
    const { createPostgresDatabase } = await import("./postgres.js");
    lockDb = createPostgresDatabase(migrationUrl, { max: 1 });
    owned = true;
  }
  try {
    await lockDb.withSession((session) => withMigrationLock(session, options));
  } finally {
    if (owned) await lockDb.close();
  }
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
 *
 * Each migration file is applied in its own transaction together with its
 * history insert. A failed file rolls back only that file; previously
 * committed files remain applied; later files are not started. A subsequent
 * run resumes at the first unapplied file. Checksums of already-applied files
 * are still verified.
 *
 * PostgreSQL: one session-level advisory lock (`pg_advisory_lock`) is held for
 * the whole run and released in `finally`. That lock serializes concurrent
 * runners across processes, servers, and serverless isolates connected to the
 * **same PostgreSQL server/database**. It is not process-local. It does not
 * coordinate a different database or a different PostgreSQL server.
 *
 * The lock requires a **session-capable** connection (local `pg.Pool` to
 * Postgres, Neon direct hostname, or `DATABASE_URL_UNPOOLED` / `DIRECT_URL` /
 * `POSTGRES_URL_NON_POOLING`). A transaction pooler (Neon `-pooler`, PgBouncer
 * port 6543) does not preserve the backend across per-file COMMIT. Query
 * traffic via `getDatabase()` may still use the pooled `DATABASE_URL`.
 *
 * PGlite: process-local queue only (no advisory lock). Preview/dev is a
 * single in-process database.
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
