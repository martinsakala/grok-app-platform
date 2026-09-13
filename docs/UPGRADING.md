# Upgrading the platform

* The platform lives in an app repository under `/platform`.
* Files under `/platform/**` must not be edited by hand in a concrete application.
* Upgrade is done via `git subtree pull`.
* Before upgrading, check `compatibility.json`.
* If `breaking=true` or `requiresAppChanges=true`, the agent must not perform a blind upgrade; evaluate migration instructions first.
* A normal platform upgrade must not change application files under `/app/**`.
* After upgrade, verify `platform/VERSION`, build, tests, and `git diff -- app/`.

## 0.4.1

`breaking=false`, `requiresAppChanges=true`, `requiresDatabaseMigration=false`, `appContractVersion=2`.

Shared preview PGlite. Hosts should:

1. `git subtree pull --prefix=platform platform-upstream main --squash`.
2. In server-only boot (`app/db.server.ts`), **before** `getDatabase()` / `runMigrations()`:

   ```ts
   import { getPglite } from "../src/lib/db";
   import { setPgliteFactory } from "../platform/src/database/index.js";
   setPgliteFactory(() => getPglite());
   ```

3. Do not import host `src/lib/db.ts` from `/platform`. Do not rewrite Grok `src/lib/db.ts` or `src/lib/auth/`.
4. Keep the Nitro PGlite wasm/data copy (Grok still needs it).
5. Do not edit `platform/migrations/private/0002_auth.sql`.

Without step 2, platform still opens a second PGlite and `getAuthDiagnostics().schemaReady` describes that private instance, not Better Auth.

## 0.4.0

`breaking=false`, `requiresAppChanges=true`, `requiresDatabaseMigration=true`, `appContractVersion=2`.

Shared auth. Hosts that want Google sign-in should:

1. `git subtree pull --prefix=platform platform-upstream main --squash` — do not hand-edit `/platform`.
2. Delete `VITE_AUTH_ENABLED` from `.grok/app-env.json` and restart via `npm run dev` / `startup.sh`.
3. `cp migrations/auth/0001_auth.sql migrations/0001_auth.sql` (Grok Better Auth schema; do not edit).
4. Add `app/routes/api/auth/$.ts` forwarding GET/POST to Grok `auth.handler` (relative import of `src/lib/auth/server` — `@/*` points at `/app/*`).
5. Add application-owned `/login` with Sign in with Google (`signIn("grok-google")`) and `<UserButton />`.
6. Add `app/auth.server.ts` that binds Grok `auth.api.getSession` to platform `createAuthSessionSource` / `requireUser` / `getCurrentUser`. Pass `authMiddleware`'s `bearerToken` in preview.
7. Scope every per-user read/write with `requireUser().id`. Never trust a client-supplied `user_id`. Keep `user_id` as `TEXT` with no FK to `public."user"`.
8. Leave `/api/health` and `/api/version` public. Optional: attach `getAuthDiagnostics()` (`{ schemaReady }`) without treating unsigned-in as degraded.

Do not rewrite `src/lib/auth/`, do not add `.env`, do not create `src/routes/auth/popup.tsx`. See `docs/AUTH.md`.

## 0.3.1

`breaking=false`, `requiresAppChanges=false`, `requiresDatabaseMigration=false`.

Stabilization of migration transaction and lock semantics. No application code changes. Hosts already calling `runMigrations` pick up per-file commits and session-level PostgreSQL advisory locking on upgrade.

## 0.3.0

`requiresAppChanges=true`, `requiresDatabaseMigration=true`.

Host apps that want the database capability should:

1. Keep `pg` and `@electric-sql/pglite` (already in the Grok Build template).
2. Add `app/migrations/` and `app/migrations-api/` SQL files as needed.
3. Call `runMigrations({ applicationMigrations, apiMigrations })` from **server-only** code, passing SQL via Vite `?raw` imports (not filesystem paths).
4. Change `getHealthResponse()` callers to `await getHealthResponse()`; the payload now includes `database: { status, engine }`.
6. Import `defineAppConfig` from `platform/src/runtime/app-config.ts` on the client. Do not import `platform/src/runtime/index.ts` or `platform/src/database` from client components.
7. After a production Nitro/Vercel build, PGlite JS is bundled but `pglite.data` / `pglite.wasm` / `initdb.wasm` are not. Copy those files from `node_modules/@electric-sql/pglite/dist/` next to the emitted `electric-sql__pglite*.mjs` chunk (typically `.vercel/output/functions/__server.func/_libs/`). Without this, production `/api/health` fails with `ENOENT …/pglite.data`. Dev/preview Vite SSR does not need the copy. See `docs/HOST_LAYOUT.md`.
