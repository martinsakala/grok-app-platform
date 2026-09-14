# Upgrading the platform

* The platform lives in an app repository under `/platform`.
* Files under `/platform/**` must not be edited by hand in a concrete application.
* Upgrade is done via `git subtree pull`.
* Before upgrading, check `compatibility.json`.
* If `breaking=true` or `requiresAppChanges=true`, the agent must not perform a blind upgrade; evaluate migration instructions first.
* A normal platform upgrade must not change application files under `/app/**`.
* After upgrade, verify `platform/VERSION`, build, tests, and `git diff -- app/`.


## 0.8.0

`breaking=false`, `requiresAppChanges=false`, `requiresDatabaseMigration=true`, `appContractVersion=3`.

Settings and an append-only audit log. Host catch-all from 0.6.0 is enough —
new routes register inside the platform. **Subtree pull applies
`0004_settings_audit.sql` on the next `runMigrations`.** Do not edit historical
SQL. No retention: `private.audit_log` grows until you archive it.

1. `git subtree pull --prefix=platform platform-upstream main --squash`.
2. No new host files. Keep the 0.6.0 catch-all and aliases.
3. After publish, the first request runs `0004`. Then, as owner:

   ```bash
   curl -sS -X PUT https://APP.grok.me/api/platform/settings/app.theme \
     -H 'content-type: application/json' \
     -H 'cookie: __Host-grok-auth.session_token=…' \
     -d '{"value":{"color":"dark"}}'
   ```

   List recent audit rows (admin+):

   ```bash
   curl -sS 'https://APP.grok.me/api/platform/admin/audit?limit=50' \
     -H 'cookie: __Host-grok-auth.session_token=…'
   ```

See `docs/SETTINGS.md` and `docs/AUDIT.md`. Keep `setPgliteFactory` and the
Nitro **closeBundle** PGlite copy; do **not** replace `nitro({ hooks.compiled })`.

## 0.7.1

`breaking=false`, `requiresAppChanges=false`, `requiresDatabaseMigration=true`, `appContractVersion=3`.

Closes the first-user owner race on a public app. **Always set `ownerEmails`.**
Empty `ownerEmails` keeps the 0.7.0 first-authenticated-user bootstrap and is
preview/dev behaviour only.

1. `git subtree pull --prefix=platform platform-upstream main --squash`.
2. No new host files. If the host is still on 0.6.0, `0003_access.sql` applies
   on the next `runMigrations`.
3. In `app/app-config.ts` set `ownerEmails` to the operators who should own
   the app (trim/lowercase is done by `defineAppConfig`):

   ```ts
   export default defineAppConfig({
     name: "my-app",
     version: "0.1.0",
     dataApiVersion: "0.5.1",
     ownerEmails: ["you@example.com"],
   });
   ```

4. After publish, listed users sign in and `GET /api/platform/me` shows
   `roles` containing `owner`. Then switch the access policy to allowlist
   (same curl as 0.7.0).

See `docs/ACCESS.md`.

## 0.7.0

`breaking=false`, `requiresAppChanges=false`, `requiresDatabaseMigration=true`, `appContractVersion=3`.

Principals, roles, allowlist, API keys. Host catch-all from 0.6.0 is enough —
new routes register inside the platform. **Subtree pull applies
`0003_access.sql` on the next `runMigrations`.** Do not edit historical SQL.

1. `git subtree pull --prefix=platform platform-upstream main --squash`.
2. No new host files. Keep the 0.6.0 catch-all and aliases.
3. After publish, the **first signed-in user becomes owner**. Later users
   become `member` while the policy is `open` (the migration default).
4. As that owner, switch the policy to allowlist — **do this as the first
   step on every new app**:

   ```bash
   curl -sS -X PUT https://APP.grok.me/api/platform/admin/access-policy \
     -H 'content-type: application/json' \
     -H 'cookie: __Host-grok-auth.session_token=…' \
     -d '{"mode":"allowlist","allowed_emails":["you@example.com"],"allowed_domains":[]}'
   ```

5. Optional: create the first API key (plaintext is returned once):

   ```bash
   curl -sS -X POST https://APP.grok.me/api/platform/api-keys \
     -H 'content-type: application/json' \
     -H 'cookie: __Host-grok-auth.session_token=…' \
     -d '{"name":"ci","roles":["member"]}'
   ```

   Then `Authorization: Bearer gk_…` against `/api/platform/me` or
   `/api/platform/data/:resource`. Rotate by revoke + create.

See `docs/ACCESS.md`. Keep `setPgliteFactory` and the Nitro **closeBundle**
PGlite copy; do **not** replace `nitro({ hooks.compiled })`.

## 0.6.0

`breaking=false`, `requiresAppChanges=true`, `requiresDatabaseMigration=false`, `appContractVersion=3`.

Logger + platform HTTP router. **Subtree pull alone is not enough** — add the
catch-all. Auth, data-API registry, query traffic, and migrations are unchanged.
No historical SQL edits.

1. `git subtree pull --prefix=platform platform-upstream main --squash`.
2. Add `app/routes/api/platform/$.ts` that forwards `GET`/`POST`/`OPTIONS` (and
   `HEAD` if the host lists it) to `createPlatformHandler`. Bind
   `sessionSource: (request) => …` from `app/auth.server.ts` so the request's
   `Authorization` header and cookies reach Better Auth. Pass `appConfig`,
   `dataApi`, `getDatabase`, and optional `healthExtras`.
3. Replace `app/routes/api/health.ts`, `version.ts`, and `data/$resource.ts`
   with one-line aliases: rewrite the URL path to `/api/platform/health`,
   `/api/platform/version`, `/api/platform/data/:resource` and call the same
   handler. Keep those URLs — monitoring and the deployer still use them.
4. Move host-only health fields (`connection` snapshot, `databaseShared`,
   `auth.schemaReady`) into `healthExtras`. Do not fork `getHealthResponse`.
5. Keep `setPgliteFactory(() => getPglite())` from 0.4.1. Keep the host Nitro
   **closeBundle** PGlite wasm/data copy; do **not** replace
   `nitro({ hooks.compiled })`.
6. Do not edit `platform/migrations/private/0002_auth.sql`.

After upgrade, unsigned preview: `/api/platform/health` ok/pglite,
`/api/platform/version` `platformVersion` 0.6.0, `/api/platform/data/x` 401,
`/api/health` and `/api/version` aliases still work, `/api/platform/nope` 404.

## 0.5.1

`breaking=false`, `requiresAppChanges=false`, `requiresDatabaseMigration=false`, `appContractVersion=2`.

Unique list order. **Subtree pull alone does not change application behavior** for hosts that already return `id` (implicit `uniqueBy`). Auth, query traffic, and migrations are unchanged.

1. `git subtree pull --prefix=platform platform-upstream main --squash`.
2. Optional: set `uniqueBy` explicitly even when `id` is returned.
3. If a resource does **not** return `id`, add `uniqueBy` to the registry (0.5.0 would have paginated unstably). Do not edit historical SQL.
4. Keep the host Nitro **closeBundle** PGlite wasm/data copy; do **not** replace `nitro({ hooks.compiled })`.

OFFSET pagination is unique for a frozen row set. Concurrent writes can still skip or repeat rows. This is not cursor pagination.

## 0.5.0


`breaking=false`, `requiresAppChanges=false`, `requiresDatabaseMigration=false`, `appContractVersion=2`.

Read-only data API. **Subtree pull alone does not change application behavior.** Query traffic, migrations, and auth are unchanged from 0.4.2.

To **enable** the capability in a host (not part of a blind upgrade):

1. `git subtree pull --prefix=platform platform-upstream main --squash`.
2. Add a new `app/migrations-api/000N_*.sql` view over the domain table (`CREATE VIEW api.<relation> AS SELECT <columns> FROM app.<table>`). Do not edit historical migration files, including `0002_auth.sql`.
3. Pass that SQL into `runMigrations({ apiMigrations })` via Vite `?raw`.
4. Register the resource with `defineDataApi` in application server code (`ownerColumn` required).
5. Add a thin `GET /api/data/:resource` adapter that calls `requireUser` then `listResource`. Do not accept client SQL, schema, or `user_id` as identity.
6. Keep `setPgliteFactory(() => getPglite())` from 0.4.1. Keep the host Nitro **closeBundle** PGlite wasm/data copy; do **not** replace `nitro({ hooks.compiled })` — that hook writes `.vercel/output/config.json`.

## 0.4.2

`breaking=false`, `requiresAppChanges=false`, `requiresDatabaseMigration=false`, `appContractVersion=2`.

Migration advisory lock on a session-capable Postgres connection. Hosts that already run 0.4.1 need **no application code changes**.

1. `git subtree pull --prefix=platform platform-upstream main --squash`.
2. Optional: if production `DATABASE_URL` is a non-Neon transaction pooler, set `DATABASE_URL_UNPOOLED` (or `DIRECT_URL` / `POSTGRES_URL_NON_POOLING`) to a direct URL. Neon `*-pooler.*.neon.tech` is rewritten automatically by removing that label only — other hostnames are never rewritten.
3. Keep `setPgliteFactory(() => getPglite())` from 0.4.1. Do not import host `src/lib/db.ts` from `/platform`.
4. Do not edit `platform/migrations/private/0002_auth.sql`. Auth public API is unchanged.

A local `pg.Pool` to Postgres preserves session locks. A transaction pooler does not. See `docs/DATABASE.md`.

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
