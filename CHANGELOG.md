# Changelog

## 0.7.0
- **Principal** (`src/auth`): `requirePrincipal` is a signed-in user or an API key (`gk_…`). `Role` is `owner` ⊇ `admin` ⊇ `member`. `requireRole` / `hasRole`. `requireUser` stays. `assignOwner` / `ownerIdFromSession` / data-API list accept `Principal` or `AuthUser`. Client `user_id` is still never identity.
- **Access** (`src/access`, migration `0003_access.sql`): first authenticated user becomes `owner` (serialized on `private.access_policy`). Later users become `member` if the allowlist allows them. Default mode is `open`; switch new apps to `allowlist`. Owner always passes. `listUsers` / `setRoles` (admin+; last owner cannot be dropped; admin cannot change an owner). `getAccessPolicy` / `setAccessPolicy` (owner).
- **API keys** (`src/api-keys`): `gk_` + 32 random bytes (base64url), SHA-256 hash stored, plaintext returned once. Roles cannot exceed the creator. Data API scoped to `ownerUserId`. Revoke → 401. Key and hash are never logged.
- **HTTP**: POST/PUT/DELETE, JSON body limit, 405 for known path + wrong method, 400 invalid JSON. New routes: `/me`, `/admin/users`, `/admin/users/:id/roles`, `/admin/access-policy`, `/api-keys`. `/data/:resource` uses `requirePrincipal`. Host catch-all unchanged (`requiresAppChanges=false`).
- `breaking=false`, `requiresAppChanges=false`, `requiresDatabaseMigration=true`, `appContractVersion` remains 3. No historical migration edits.

## 0.6.0
- **Logger** (`src/logging`): `createLogger(name)` writes one JSON line `{ts, level, name, msg, ...fields}`. `setLogSink` is the pluggable output (default `console`). Keys matching `SECRET_KEY_PATTERN` become `"[redacted]"`; string values are scrubbed of `postgres://` / `postgresql://` URLs and Bearer tokens. `logError` records `{name, code, message}` only — no stack, no DB URL/host/user. Platform `console.error("[platform] … failed")` sites now call `logError` with the caught error.
- **HTTP router** (`src/http`): `createPlatformHandler` serves `GET /api/platform/health`, `/version`, `/data/:resource` from an internal method+path registry. Future capabilities add routes inside the platform; hosts keep one catch-all. Errors: `UnauthorizedError` → 401 `{error:"Unauthorized"}`; `DataApiError` → its status/code; anything else → 500 `{error:"Internal Server Error"}` plus `logError`. Unknown routes → 404 `{error, code:"not_found"}`. Responses are `cache-control: no-store`. Client `user_id` / schema / table / sql query params are ignored. Optional `healthExtras` lets the host attach a connection snapshot without forking health.
- Hosts add `app/routes/api/platform/$.ts` and keep `/api/health`, `/api/version`, `/api/data/:resource` as one-line aliases that rewrite the path onto the same handler.
- `breaking=false`, `requiresAppChanges=true` (catch-all file), `requiresDatabaseMigration=false`, `appContractVersion=3`. Data-API and auth contracts are unchanged. No historical migration edits.

## 0.5.1
- Deterministic read-only list order: `uniqueBy` is a sort key independent of returned `columns`. `ORDER BY` uses `orderBy` then `uniqueBy` (once, when they differ). The unique column is not selected unless it is also in `columns`.
- Compatibility: if `uniqueBy` is omitted and `id` is among `columns`, `id` remains the unique key (existing 0.5.0 host registrations keep working). Other incomplete configurations are rejected at `defineDataApi`. That is a fail-closed fix of previously unstable pagination, not a new product feature.
- Uniqueness is an **application invariant** on the published view, at least within one owner. The column name `id` does not prove it.
- Unique `ORDER BY` is not a consistent snapshot: OFFSET pages can still skip or repeat rows when rows are inserted, updated, or deleted concurrently. No cursor pagination, no generic filter language, no auth changes, no historical migration edits.
- `breaking=false`, `requiresAppChanges=false`, `requiresDatabaseMigration=false`, `appContractVersion` remains 2. Hosts that already return `id` need no code change. Hosts that listed resources without `id` and without `uniqueBy` must add `uniqueBy` (those never had the documented unique order).

## 0.5.0
- Added a **read-only data API** (`src/data-api`): hosts register named resources over schema `api`; `listResource` returns an explicit column list for the verified session user.
- Positive allowlist only. Schema `api` is required but not sufficient. `public`, `private`, and `app` are never published. Auth denylist remains defense-in-depth.
- Every 0.5.0 resource requires `ownerColumn`. The server always filters by `requireUser().id`. Client `user_id`, schema, table, SQL, and column lists are ignored as authorization.
- Identifiers are validated and quoted. Values are parameterized. Default page size 50, max 100, deterministic `ORDER BY` with `id` tiebreaker when present.
- Failures return `DataApiError` without SQL, connection strings, or schema dumps. Anonymous access is `UnauthorizedError` (401).
- No write, delete, RPC, arbitrary SQL, client joins, or generic filter language.
- Platform upgrade is non-breaking (`requiresAppChanges=false`, `requiresDatabaseMigration=false`, `appContractVersion` remains 2). Enabling the capability is a host step: API view + registry + thin GET adapter. See `docs/DATA_API.md` and `docs/UPGRADING.md`.

## 0.4.2
- Migration runner uses a **session-capable** Postgres connection for `pg_advisory_lock`. Query traffic (`getDatabase()`, Better Auth, `getSql()`) still uses `DATABASE_URL` as injected.
- A local `pg.Pool` to a real Postgres session preserves backend state across per-file COMMIT. A **transaction pooler** (Neon `-pooler` hostname, PgBouncer port 6543, `pgbouncer=true`) does not — `pg.Pool.connect()` there is not a Postgres session.
- Supported direct URL for migrations, in order: `DATABASE_URL_UNPOOLED`, `DIRECT_URL`, `POSTGRES_URL_NON_POOLING`. Neon `*-pooler.*.neon.tech` is rewritten by removing that `-pooler` label only. Other hostnames are never rewritten. Detected non-Neon poolers without an explicit direct URL fail closed.
- Public API `getDatabase` / `runMigrations` / auth helpers unchanged. `0002_auth.sql` unchanged. `requiresAppChanges=false`.
- `scripts/prove-advisory-lock.mjs` runs two processes against a throwaway Postgres to prove the lock spans the inter-file gap and unlocks on success and error.

## 0.4.1
- Preview database convergence: hosts inject Grok `getPglite()` via `setPgliteFactory`. Better Auth, Grok `getSql()`, and platform `getDatabase()` then share one PGlite. Public API `getDatabase` / `runMigrations` / `getDatabaseDiagnostics` is unchanged.
- Native Grok `getSql()` is **not** the production adapter: it has no transactions, no multi-statement `exec`, and no held client, so it cannot keep a session-level `pg_advisory_lock` across per-file COMMIT. Production still uses the platform `pg` Pool (`withSession`) against the same `DATABASE_URL` Better Auth uses.
- `0002_auth.sql` is unchanged (historical). Canonical Better Auth schema owner is Grok `migrations/auth/0001_auth.sql`. Platform `0002_auth.sql` is a compatibility bootstrap (`IF NOT EXISTS`).
- `getAuthDiagnostics()` still probes `getDatabase()`. After the host injects Grok PGlite that is the real Better Auth schema, not a second WASM database.
- Future generic data API is a positive allowlist on schema `api` only. `AUTH_RELATIONS_EXCLUDED_FROM_DATA_API` is defense-in-depth.
- Hosts must call `setPgliteFactory(() => getPglite())` from server-only boot. `requiresAppChanges=true`, `requiresDatabaseMigration=false`.
- Platform still ships `@electric-sql/pglite` for tests and for hosts that do not inject. The host Nitro PGlite wasm/data copy stays — Grok `src/lib/db.ts` still loads those files.

## 0.4.0
- Added shared server-side auth API (`src/auth`): `AuthUser`, `getCurrentUser`, `requireUser`, `getCurrentSession`, `UnauthorizedError`.
- Wraps Grok Build Better Auth / Google OAuth (`auth.grok.me`). No custom OAuth, no `better-auth` dependency in this repository.
- Platform migration `0002_auth.sql` creates Better Auth identity tables in `public` (documented Grok/Better Auth schema exception). Other operational tables stay in `private`. Future data API must exclude these tables.
- Invariant: client-provided `user_id` is never an authorization authority. `ownerIdFromSession` / `assignOwner` always use the verified session.
- `getAuthDiagnostics()` reports `{ schemaReady }` only — no secrets, no current user. Unsigned-in is not a health failure.
- App contract version 2. Hosts must add thin `/api/auth/$` + `/login` + a Grok session adapter.

## 0.3.1
- Migration runner applies each file in its own transaction (SQL + history insert). A failed file rolls back only itself; earlier files remain committed; later files are not started. Re-runs resume at the first unapplied file. Checksums of applied files are still verified.
- PostgreSQL holds one session-level advisory lock (`pg_advisory_lock`) for the whole run and always releases it, serializing concurrent runners connected to the same PostgreSQL server/database. The lock is not process-local. PGlite still uses only the process-local queue.
- No application contract changes.

## 0.3.0
- Added server-only database abstraction: PGlite when `DATABASE_URL` is unset, PostgreSQL (`pg`) when it is set.
- Added migration runner with separate histories for platform (`private.platform_migrations`), application, and API.
- First platform migration creates schemas `private`, `app`, and `api`.
- Health response is async and includes a safe `{ database: { status, engine } }` probe.
- Platform SQL is embedded at generate-time (`src/database/generated/platform-migrations.ts`) so production bundles do not read `.sql` from disk.
- Production Nitro/Vercel builds must copy PGlite `pglite.data` / `pglite.wasm` next to the bundled chunk (host glue; documented in HOST_LAYOUT and UPGRADING).

## 0.2.1
- Platform version is a generated TypeScript constant (`src/runtime/generated/platform-version.ts`) produced from the root `VERSION` file.
- Runtime no longer reads `VERSION` from the filesystem (`import.meta.url` lookup failed after production bundling).
- Added `npm run generate:version`; generation runs before `test`, `typecheck`, and `build`.

## 0.2.0
- Added minimal runtime capability: AppConfig contract, version response, and health response helpers under `src/runtime`.
- Apps must supply AppConfig and thin route adapters; platform remains app-agnostic.
- No HTTP routes in the platform repository.

## 0.1.1
- Added subtree upgrade verification marker.

## 0.1.0
- Initial platform structure and ownership boundaries.
