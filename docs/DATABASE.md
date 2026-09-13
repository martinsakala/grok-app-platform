# Database

Server-side database capability for Grok Build hosts.

## Engines

| Condition | Engine | Persistence |
| --- | --- | --- |
| `DATABASE_URL` is unset or whitespace | **PGlite** (Postgres compiled to WASM, in-process) | Ephemeral — gone on preview/dev restart |
| `DATABASE_URL` is a non-empty server-side env var | **PostgreSQL** via `node-postgres` (`pg`) | Durable (Neon or any Postgres URL) |

Preview PGlite is **not** IndexedDB / browser persistence. The database runs on the server (Vite SSR / Node). Do not expect data to survive a sandbox restart.

## Native Grok `getSql()` vs this layer

Grok `src/lib/db.ts` (do not rewrite) exports:

| | `getSql()` | `getPglite()` | this platform |
| --- | --- | --- | --- |
| Parameterized `query` | yes (`rows[]`) | yes | yes (`{ rows, rowCount }`) |
| Multi-statement `exec` | **no** | yes | yes |
| `transaction` | **no** | yes (`pg.transaction`) | yes |
| Held backend session | **no** (pool borrow per query on Neon) | yes (single connection) | yes (`withSession`) |
| Session-level `pg_advisory_lock` across COMMITs | **no** | n/a (skipped on PGlite) | PostgreSQL only |
| Better Auth preview | via `getPglite()` | **the shared instance** | inject that instance |
| Production `DATABASE_URL` | own `pg` Pool | throws | own `pg` Pool, same URL |

Neon pooled endpoints keep **no session state** (Grok neon skill: do not rely on `SET`, `LISTEN/NOTIFY`, or session advisory locks). That is why production does **not** run platform migrations through `getSql()`.

## Preview: one PGlite

```
Better Auth ─┐
getSql()     ├── Grok getPglite()   ← setPgliteFactory(() => getPglite())
getDatabase()┘
```

Call from server-only host boot **before** `getDatabase()` / `runMigrations()`:

```ts
import { getPglite } from "../src/lib/db";
import { setPgliteFactory } from "../platform/src/database/index.js";

setPgliteFactory(() => getPglite());
```

The factory is host → platform. `/platform` never imports `src/lib/db.ts`.
`close()` on an adopted instance is a no-op so Better Auth keeps the WASM
Postgres. Without the factory, platform creates a private PGlite (tests /
legacy hosts) — `getAuthDiagnostics().schemaReady` would then describe that
private instance, not Better Auth.

## Production: one Postgres, platform-owned Pool

```
Better Auth  ── pg Pool ─┐
getSql()     ── pg Pool ─┼── DATABASE_URL
getDatabase()── pg Pool ─┘  (withSession + pg_advisory_lock)
```

## Production bundling (PGlite assets)

SQL migrations are embedded (generate-time for platform, Vite `?raw` for the app). PGlite itself still loads `pglite.wasm` + `pglite.data` from disk next to its JS module.

Vite **dev** SSR resolves those files from `node_modules`. Nitro **production** bundles `electric-sql__pglite.mjs` but does not emit the sibling data files, which produces:

```
ENOENT: open '.../functions/__server.func/_libs/pglite.data'
```

The host must copy `pglite.data`, `pglite.wasm`, and `initdb.wasm` next to that chunk after `vite build`. This is host glue, not a `/platform` patch. Sharing one PGlite does **not** remove the copy: Grok `src/lib/db.ts` still loads those files. Real production PostgreSQL (`DATABASE_URL` set) does not need the copy at runtime, but preview-mode production builds (no `DATABASE_URL`) still do.

The platform package keeps `@electric-sql/pglite` for tests and for hosts that do not inject a factory.

## Why `pg`

The production driver is **`pg` (node-postgres)**:

* already present in Grok Build hosts;
* parameterized queries (`$1`, `$2`, …);
* TLS is controlled by the connection string (`sslmode=require`, etc.);
* a small pool (`max: 4`) reuses warm serverless instances without opening dozens of connections;
* `withSession` holds one `PoolClient` so `pg_advisory_lock` outlives per-file COMMIT.

Values are never interpolated into SQL strings.

## Server-only

`platform/src/database` must only be imported from TanStack **server** handlers, `createServerFn`, or other Node code.

* Do not import it from `app/routes/__root.tsx` or any client component.
* Import `defineAppConfig` from `platform/src/runtime/app-config.ts` on the client; import `getHealthResponse` / `getDatabase` only in server route adapters.
* The module throws if it detects a browser `document` global.

Never log or return `DATABASE_URL`, hostname, username, database name, or driver error text.

## Schemas

| Schema | Owner | Contents |
| --- | --- | --- |
| `private` | platform | Internal/operational data. Migration histories live here. **No application domain tables. Not part of any public data API.** |
| `app` | application | Canonical domain model. Platform must not create domain tables here. |
| `api` | application (explicit publish) | Views/functions the app chooses to expose. **The only future generic data-API allowlist.** |
| `public` | Grok Better Auth (exception) | `"user"`, `"session"`, `"account"`, `"verification"` — required by Better Auth 1.6.x as wired by Grok. Canonical DDL is Grok `migrations/auth/0001_auth.sql`. Platform `0002_auth.sql` is a frozen `IF NOT EXISTS` bootstrap. Not a public data API. See `docs/AUTH.md`. |

Do not auto-publish `public`, `private`, or `app`.

## Public API

```ts
import {
  getDatabase,
  getDatabaseEngine,
  runMigrations,
  getDatabaseDiagnostics,
  defineMigrations,
  setPgliteFactory,
} from "../platform/src/database/index.js";
```

* `getDatabase()` — lazy singleton (`pglite` or `postgresql`).
* `setPgliteFactory(() => getPglite())` — host injects Grok's preview instance.
* `runMigrations({ applicationMigrations, apiMigrations })` — platform first, then app, then API.
* `getDatabaseDiagnostics()` — `{ engine, connected, migrationsReady }` with no secrets.

Lifecycle:

```
setPgliteFactory(() => getPglite())   // preview hosts
getDatabase()
  → runMigrations({ applicationMigrations, apiMigrations })
  → application queries
```

Call `runMigrations` once at boot (or at the start of the first server request). Concurrent callers in one process are queued.

Each migration **file** is its own transaction (file SQL + history insert). A failure rolls back only that file; earlier files stay committed; later files are not started. The next run resumes at the first unapplied file. Checksums of already-applied files are still verified.

**PostgreSQL** holds one **session-level** advisory lock (`pg_advisory_lock`) for the whole run and releases it in `finally`. That lock serializes migration runners across processes, hosts, and serverless isolates **connected to the same PostgreSQL server/database**. It is not process-local. A transaction-scoped lock cannot be used: it would be released between per-file commits.

**PGlite** uses only the process-local queue (no advisory lock).

## Public API contract

`getDatabase`, `runMigrations` options, `AppConfig`, and health/version payloads are unchanged in 0.4.1. Hosts that want a shared preview database add `setPgliteFactory` (app contract 2, `requiresAppChanges=true`, no new SQL file).
