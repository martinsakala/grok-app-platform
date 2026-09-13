# Migrations

## Ownership

| Kind | Canonical files (downstream host) | History table | Who writes them |
| --- | --- | --- | --- |
| Platform | `platform/migrations/private/*.sql` | `private.platform_migrations` | platform upstream only |
| Application | `app/migrations/*.sql` | `private.application_migrations` | the application |
| API | `app/migrations-api/*.sql` | `private.api_migrations` | the application |

Do **not** share one integer sequence across the three kinds. Each kind is ordered by **filename** (`0001_…sql`, `0002_…sql`, …).

Platform `0002_auth.sql` is a **historical 0.4.0 compatibility bootstrap** (`IF NOT EXISTS` of Better Auth tables in `public`). It must not be edited. Canonical Better Auth DDL is Grok `migrations/auth/0001_auth.sql`. Do not add later platform migrations that copy new Better Auth internal columns.

## Transaction semantics

The runner does **not** wrap the whole platform → application → API run in one transaction.

* Each migration **file** is applied in its own database transaction.
* That transaction contains both the file’s SQL and the insert of its history row.
* If a file fails, **only that file** is rolled back. Partial work from that file does not remain.
* Later files in the same run are **not** started.
* Files that already committed stay committed (including earlier kinds in the same run).
* A later `runMigrations` call resumes at the first unapplied file. Already-applied files are skipped after checksum verification.

Do not put `BEGIN`/`COMMIT` in a migration file.

## Checksums

Each applied file is stored with a SHA-256 checksum of its SQL text. Re-running is a no-op when the checksum matches. If a previously applied file’s content changes, the runner **fails** before applying later files. Add a new file; never edit a released migration. Unapplied files may still be corrected — they are not in history yet.

## Locking

Concurrent callers **in one process** share a process-local queue (PGlite and PostgreSQL).

**PostgreSQL** additionally takes one **session-level** advisory lock (`pg_advisory_lock`) for the entire run and always releases it (`pg_advisory_unlock`) before returning the connection. The lock is held across per-file commits; a transaction-scoped lock (`pg_advisory_xact_lock`) would be released between files and would not serialize the batch.

That advisory lock coordinates **all sessions connected to the same PostgreSQL server/database** — other processes, other hosts, and serverless isolates that share the database. It is **not** process-local. It does **not** coordinate a different database or a different PostgreSQL server.

The lock is taken on a **session-capable** connection:

* A local `pg.Pool` to real Postgres (`localhost`, RDS, Neon **without** `-pooler`) holds a backend session; `pg_advisory_lock` survives per-file COMMIT.
* A **transaction pooler** (Neon `*-pooler.*.neon.tech`, PgBouncer port 6543) does not. After COMMIT the backend is returned; a session lock leaks and does not cover the next file.

`runMigrations` therefore resolves a direct URL (`DATABASE_URL_UNPOOLED` / `DIRECT_URL` / `POSTGRES_URL_NON_POOLING`, or the documented Neon `-pooler` hostname rewrite). It does not blindly rewrite other hostnames. Query traffic may keep using the pooled `DATABASE_URL`. `scripts/prove-advisory-lock.mjs` is the two-process proof (throwaway DB only).

**PGlite** has no advisory lock. Preview/dev is a single in-process database; only the process-local queue serializes callers.

Do not run this runner through Grok `getSql()`: that API has no held client, so the session-level lock cannot outlive per-file COMMIT.


## Production bundling

Runtime **must not** read `.sql` files from the filesystem (`import.meta.url` lookups break after Vite/Nitro bundling).

* Platform SQL is compiled into `src/database/generated/platform-migrations.ts` by `npm run generate:migrations` and committed.
* Downstream apps should pass SQL **into** `runMigrations` as `{ filename, sql }[]`.
  Preferred host mechanism: Vite `?raw` imports (inlined into the server bundle):

  ```ts
  import itemsSql from "./migrations/0001_test_table.sql?raw";
  import viewSql from "./migrations-api/0001_test_view.sql?raw";

  await runMigrations({
    applicationMigrations: [{ filename: "0001_test_table.sql", sql: itemsSql }],
    apiMigrations: [{ filename: "0001_test_view.sql", sql: viewSql }],
  });
  ```

  `defineMigrations(...)` validates filenames and freezes a sorted list.

Optional: generate a TypeScript manifest the same way the platform does. Do not pass filesystem paths into the runner.
