# Changelog

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
