# Migrations

## Ownership

| Kind | Canonical files (downstream host) | History table | Who writes them |
| --- | --- | --- | --- |
| Platform | `platform/migrations/private/*.sql` | `private.platform_migrations` | platform upstream only |
| Application | `app/migrations/*.sql` | `private.application_migrations` | the application |
| API | `app/migrations-api/*.sql` | `private.api_migrations` | the application |

Do **not** share one integer sequence across the three kinds. Each kind is ordered by **filename** (`0001_…sql`, `0002_…sql`, …).

## Checksums

Each applied file is stored with a SHA-256 checksum of its SQL text. Re-running is a no-op when the checksum matches. If a previously applied file’s content changes, the runner **fails**. Add a new file; never edit a released migration.

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

## Adding an application migration

1. Create `app/migrations/000N_short_name.sql` (next numeric prefix).
2. Import it with `?raw` (or regenerate a manifest).
3. Pass it in `applicationMigrations`.
4. Deploy / restart so `runMigrations` runs once.

Same pattern for `app/migrations-api/` (views only, after application tables exist).

## SQL constraints

Portable PostgreSQL. No Neon-specific features, no extensions, no superuser-only operations. Do not put `BEGIN`/`COMMIT` in a file; the runner wraps each batch in a transaction.

## Platform files

Canonical: `migrations/private/*.sql`. After editing, run `npm run generate:migrations` and commit the generated module.
