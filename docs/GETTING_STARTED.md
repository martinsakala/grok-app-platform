# Getting started: a new application on the platform

This is the end-to-end recipe. The per-version details it consolidates live in
`docs/UPGRADING.md`, `docs/AUTH.md`, `docs/DATABASE.md` and `docs/HOST_LAYOUT.md`.

Verified reference host (private): `martinsakala/grok-app-platform-integration-test`.
It is a **test** host and carries test entities and self-checks; do not copy it
blindly. Use the template repository instead when one exists for your
platform version.

## 0. Prerequisites

- A Grok Build project. Grok generates the host chrome (`src/lib/auth/**`,
  `src/lib/db.ts`, `vite.config.ts`, `startup.sh`, `.grok/**`). Do not rewrite
  those files.
- Decide up front: does the app need sign-in and durable data? This platform
  assumes **yes** to both. For a static app you do not need it.

## 1. Pull the platform

```bash
git remote add platform-upstream https://github.com/martinsakala/grok-app-platform.git
git subtree add --prefix=platform platform-upstream main --squash
```

Check `platform/VERSION` and `platform/compatibility.json`.

## 2. Host glue (root, host-owned)

1. `vite.config.ts`: `tanstackStart({ srcDirectory: "app" })`, alias `@/*` → `/app/*`.
   Keep `nitro({ preset: "vercel", serverDir: "./server" })` **without** overriding
   `hooks.compiled` (the preset writes `.vercel/output/config.json` there; without
   it the deployer looks for a static `dist` and the publish fails). Copy PGlite
   `pglite.data` / `pglite.wasm` / `initdb.wasm` next to the bundled
   `electric-sql__pglite*.mjs` in a `closeBundle` plugin.
2. `.grok/app-env.json`: `{ "deploy": { "database": true } }`. Remove
   `VITE_AUTH_ENABLED` so sign-in is on.
3. `cp migrations/auth/0001_auth.sql migrations/0001_auth.sql` (Grok's canonical
   Better Auth schema; never edit it).
4. Put project rules in `AGENTS.project.md` (start from
   `platform/docs/host/AGENTS.project.md`). Grok's own `AGENTS.md` treats it with
   the same priority.

## 3. Application files (`/app`, application-owned)

| File | Role |
| --- | --- |
| `app/app-config.ts` | `defineAppConfig({ name, version, dataApiVersion })` |
| `app/db.server.ts` | `setPgliteFactory(() => getPglite())` at module top, then `ensureAppDatabase()` that calls `runMigrations({ applicationMigrations, apiMigrations })` once |
| `app/auth.server.ts` | binds Grok `auth.api.getSession` to platform `createAuthSessionSource`; exports `requireUser`, `getCurrentUser`, `getCurrentSession` |
| `app/data-api.ts` | `defineDataApi({ resources: [...] })` — only if you publish read-only lists |
| `app/migrations/000N_*.sql` | domain tables in schema `app` |
| `app/migrations-api/000N_*.sql` | `CREATE VIEW api.<name> AS SELECT <explicit columns> FROM app.<table>` |
| `app/routes/api/health.ts`, `version.ts` | thin adapters over `getHealthResponse` / `getVersionResponse` |
| `app/routes/api/auth/$.ts` | one-line forward to Grok `auth.handler` (relative import of `src/lib/auth/server`) |
| `app/routes/api/data/$resource.ts` | optional thin GET adapter: `requireUser` then `listResource` |
| `app/routes/login.tsx` | application-owned sign-in UI using Grok `signIn("grok-google")` |

Rules that matter most:

- Call `setPgliteFactory` **before** the first `getDatabase()` / `runMigrations()`
  / `getAuthDiagnostics()`; otherwise preview opens a second PGlite and Better
  Auth data is invisible to the platform.
- Pass SQL into `runMigrations` via Vite `?raw` imports. Never filesystem paths.
- Every per-user server function: `authMiddleware` **and** `requireUser()`;
  scope every query by `user.id`. Keep `user_id` columns `TEXT`, no FK to
  `public."user"`.
- Import `platform/src/database` and `platform/src/auth` only from server-only
  code (`*.server.ts`, route `server.handlers`, `createServerFn` handlers).
- Historical migration files are immutable; a change is a new file.

## 4. Verify in preview

```
GET /api/health    → status ok, engine pglite, auth.schemaReady true
GET /api/version   → platformVersion = platform/VERSION
GET /api/auth/get-session (signed out) → null
GET /api/data/<resource> (signed out)  → 401
```

Sign in with Google in the preview, create a row, confirm a second account does
not see it.

## 5. Publish and verify production

Only the user presses **Publish**. After deploy:

```
GET https://<app>.grok.me/api/health
  database.engine postgresql, connection.neon true,
  connection.queryPooling transaction-pooler, connection.migrationVia unpooled-env,
  migrationsReady true, bootOk true
```

Grok provisions Neon and injects `DATABASE_URL` (pooled) plus an unpooled URL.
Platform migrations run at the first request after deploy, serialized by the
advisory lock. Preview data never reaches production.

## 6. Upgrading later

```bash
git subtree pull --prefix=platform platform-upstream main --squash
```

Read `platform/compatibility.json` first. `requiresAppChanges=true` means
`docs/UPGRADING.md` has steps for `/app`; a blind pull is not enough.
