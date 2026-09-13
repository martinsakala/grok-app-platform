# Database

Server-side database capability for Grok Build hosts.

## Engines

| Condition | Engine | Persistence |
| --- | --- | --- |
| `DATABASE_URL` is unset or whitespace | **PGlite** (Postgres compiled to WASM, in-process) | Ephemeral — gone on preview/dev restart |
| `DATABASE_URL` is a non-empty server-side env var | **PostgreSQL** via `node-postgres` (`pg`) | Durable (Neon or any Postgres URL) |

Preview PGlite is **not** IndexedDB / browser persistence. The database runs on the server (Vite SSR / Node). Do not expect data to survive a sandbox restart.

## Production bundling (PGlite assets)

SQL migrations are embedded (generate-time for platform, Vite `?raw` for the app). PGlite itself still loads `pglite.wasm` + `pglite.data` from disk next to its JS module.

Vite **dev** SSR resolves those files from `node_modules`. Nitro **production** bundles `electric-sql__pglite.mjs` but does not emit the sibling data files, which produces:

```
ENOENT: open '.../functions/__server.func/_libs/pglite.data'
```

The host must copy `pglite.data`, `pglite.wasm`, and `initdb.wasm` next to that chunk after `vite build`. This is host glue, not a `/platform` patch. Real production PostgreSQL (`DATABASE_URL` set) does not need the copy.

## Why `pg`

The production driver is **`pg` (node-postgres)**:

* already present in Grok Build hosts;
* parameterized queries (`$1`, `$2`, …);
* TLS is controlled by the connection string (`sslmode=require`, etc.);
* a small pool (`max: 4`) reuses warm serverless instances without opening dozens of connections.

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
| `api` | application (explicit publish) | Views/functions the app chooses to expose. Not a dump of `app`. |

## Public API

```ts
import {
  getDatabase,
  getDatabaseEngine,
  runMigrations,
  getDatabaseDiagnostics,
  defineMigrations,
} from "../platform/src/database/index.js";
```

* `getDatabase()` — lazy singleton (`pglite` or `postgresql`).
* `runMigrations({ applicationMigrations, apiMigrations })` — platform first, then app, then API.
* `getDatabaseDiagnostics()` — `{ engine, connected, migrationsReady }` with no secrets.

Lifecycle:

```
getDatabase()
  → runMigrations({ applicationMigrations, apiMigrations })
  → application queries
```

Call `runMigrations` once at boot (or at the start of the first server request). Concurrent callers in one process are queued. Production also uses `pg_advisory_xact_lock`; that does **not** coordinate independent serverless isolates.
