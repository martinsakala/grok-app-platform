# Upgrading the platform

* The platform lives in an app repository under `/platform`.
* Files under `/platform/**` must not be edited by hand in a concrete application.
* Upgrade is done via `git subtree pull`.
* Before upgrading, check `compatibility.json`.
* If `breaking=true` or `requiresAppChanges=true`, the agent must not perform a blind upgrade; evaluate migration instructions first.
* A normal platform upgrade must not change application files under `/app/**`.
* After upgrade, verify `platform/VERSION`, build, tests, and `git diff -- app/`.

## 0.3.0

`requiresAppChanges=true`, `requiresDatabaseMigration=true`.

Host apps that want the database capability should:

1. Keep `pg` and `@electric-sql/pglite` (already in the Grok Build template).
2. Add `app/migrations/` and `app/migrations-api/` SQL files as needed.
3. Call `runMigrations({ applicationMigrations, apiMigrations })` from **server-only** code, passing SQL via Vite `?raw` imports (not filesystem paths).
4. Change `getHealthResponse()` callers to `await getHealthResponse()`; the payload now includes `database: { status, engine }`.
5. Import `defineAppConfig` from `platform/src/runtime/app-config.ts` on the client. Do not import `platform/src/runtime/index.ts` or `platform/src/database` from client components.
