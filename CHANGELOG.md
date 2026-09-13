# Changelog

## 0.3.0
- Added server-only database abstraction: PGlite when `DATABASE_URL` is unset, PostgreSQL (`pg`) when it is set.
- Added migration runner with separate histories for platform (`private.platform_migrations`), application, and API.
- First platform migration creates schemas `private`, `app`, and `api`.
- Health response is async and includes a safe `{ database: { status, engine } }` probe.
- Platform SQL is embedded at generate-time (`src/database/generated/platform-migrations.ts`) so production bundles do not read `.sql` from disk.
- Host apps pass application/API SQL into `runMigrations` (Vite `?raw` or an equivalent manifest).

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
