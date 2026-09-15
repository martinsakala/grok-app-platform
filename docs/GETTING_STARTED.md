# Getting started: a new application on the platform

Read the "three things" section of the root `README.md` first: **platform**
(this library), **mother-app** (one application using it, source on GitHub),
**mother-app published** (`mother-app.grok.me`, the thing you Remix).

## Path A: Remix mother-app (the normal way)

1. Open `https://mother-app.grok.me`, use the **Created with Grok → Remix**
   pill. Grok Build creates a **new project** with a copy of the whole source:
   `/app`, `/platform`, Grok chrome, `AGENTS.project.md`, `.grok/app-env.json`,
   `migrations/0001_auth.sql`.
2. In the new project's chat, tell the agent what the app is. `AGENTS.project.md`
   already forbids building anything you did not ask for.
3. Rename the app: `app/app-config.ts` (`name`, `version`).
4. Add domain tables as `app/migrations/000N_*.sql`, views as
   `app/migrations-api/000N_*.sql`, register resources in `app/data-api.ts`,
   pass the SQL into `runMigrations` in `app/db.server.ts` via Vite `?raw`.
5. Verify in preview (section 4 below), then **Publish**. The new app gets its
   own Neon database. Preview data never reaches it.
6. Add the upstream remote once, so the agent can upgrade the platform later:

   ```bash
   git remote add platform-upstream https://github.com/martinsakala/grok-app-platform.git
   ```

Remix is a one-time fork. Later changes in mother-app do not flow into your app.
Platform versions do, via `git subtree pull` (section 6).

## Path B: bare Grok scaffold (only when Remix is not available)

Same result, assembled by hand. Grok generates the host chrome
(`src/lib/auth/**`, `src/lib/db.ts`, `vite.config.ts`, `startup.sh`, `.grok/**`);
do not rewrite those files.

### B1. Pull the platform

```bash
git remote add platform-upstream https://github.com/martinsakala/grok-app-platform.git
git subtree add --prefix=platform platform-upstream main --squash
```

### B2. Host glue (root, host-owned)

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
4. Copy `platform/docs/host/AGENTS.project.md` to the root as `AGENTS.project.md`.
   Grok's own `AGENTS.md` treats it with the same priority.

### B3. Application files (`/app`, application-owned)

| File | Role |
| --- | --- |
| `app/app-config.ts` | `defineAppConfig({ name, version, dataApiVersion })` |
| `app/db.server.ts` | `setPgliteFactory(() => getPglite())` at module top, then `ensureAppDatabase()` that calls `runMigrations({ applicationMigrations, apiMigrations })` once |
| `app/auth.server.ts` | binds Grok `auth.api.getSession` to platform `createAuthSessionSource`; exports `requireUser`, `getCurrentUser`, `getCurrentSession` |
| `app/data-api.ts` | `defineDataApi({ resources: [...] })` |
| `app/mutations.ts` | `defineMutations({ mutations: [] })` (0.13.0); pass into the handler |
| `app/routes/admin/data.tsx` | optional 0.14.0 `DataResourcesPage` (recommended mother-app default) |
| `app/routes/admin/api.tsx` | optional 0.15.0 `ApiDocsPage` (recommended mother-app default) |
| `app/migrations/000N_*.sql` | domain tables in schema `app` |
| `app/migrations-api/000N_*.sql` | `CREATE VIEW api.<name> AS SELECT <explicit columns> FROM app.<table>` |
| `app/routes/api/platform/$.ts` | catch-all → `createPlatformHandler` |
| `app/routes/api/health.ts`, `version.ts` | aliases rewriting onto `/api/platform/health` and `/version` |
| `app/routes/api/auth/$.ts` | one-line forward to Grok `auth.handler` (relative import of `src/lib/auth/server`) |
| `app/routes/api/data/$resource.ts` | alias rewriting onto `/api/platform/data/:resource` |
| `app/routes/login.tsx` | application-owned sign-in UI using Grok `signIn("grok-google")` |

The mother-app repository is the reference for every one of these files.

## Rules that matter most (both paths)

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
- Reusable across apps? It belongs in the platform, not in your app.

## 4. Verify in preview

```
GET /api/health    → status ok, engine pglite, auth.schemaReady true
GET /api/version   → platformVersion = platform/VERSION
GET /api/platform/health → same payload as /api/health
GET /api/platform/version → same payload as /api/version
GET /api/auth/get-session (signed out) → null
GET /api/data/<resource> (signed out)  → 401
GET /api/platform/data/<resource> (signed out) → 401
GET /api/platform/nope → 404 {code:"not_found"}
GET /api/platform/registry → 200 capabilities JSON (public)
GET /api/platform/llms.txt → Markdown; no secrets
```

Sign in with Google in the preview, create a row, confirm a second account does
not see it. In a fresh clone `npm run typecheck` fails until `npm run build` or
`dev` has generated `app/routeTree.gen.ts` (git-ignored); that is not a bug.

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

## 6. Upgrading the platform later

```bash
git subtree pull --prefix=platform platform-upstream main --squash
```

Read `platform/compatibility.json` first. `requiresAppChanges=true` means
`docs/UPGRADING.md` has steps for `/app`; a blind pull is not enough.
