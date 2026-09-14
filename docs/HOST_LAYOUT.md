# Host layout

Verified Grok Build host layout for applications that consume this platform.

## 1. Three ownership zones

```
/platform/** = platform-owned
/app/**      = application-owned
root host glue = host-owned
```

These zones exist so platform upgrades, application features, and host/runtime integration can change independently without stepping on each other.

## 2. Why `/app` uses `srcDirectory: "app"`

TanStack is configured with `srcDirectory: "app"` so application routes, components, and domain code live under `/app/**`, not under a generic `/src`. That keeps application ownership explicit and separate from `/platform/**` and root host glue.

## 3. Root host glue files

Host-owned root may contain only files required for Grok/TanStack/Vite/deploy runtime, typically:

```
package.json
package-lock.json
tsconfig.json
vite.config.ts
startup.sh
eslint.config.mjs
.prettierrc
.gitignore
public/
scripts/
server/
AGENTS.md
src/lib/db.ts
src/lib/auth/
```

Business/domain logic and platform runtime logic do not belong here. Alias `@/*` points to `/app/*`. Generated `app/routeTree.gen.ts` is an application-owned generated artifact.

Host `package.json` already includes `pg` and `@electric-sql/pglite` in the Grok Build template. Better Auth is also pre-wired in host `src/lib/auth/` — do not rewrite it and do not add a second OAuth stack.

Nitro's Vercel preset **does** need extra host glue for PGlite WASM assets. After `vite build`, copy `pglite.data`, `pglite.wasm`, and `initdb.wasm` from `node_modules/@electric-sql/pglite/dist/` next to the bundled `electric-sql__pglite*.mjs` (under `.vercel/output/functions/`). A Vite `closeBundle` plugin is the expected place. Do **not** replace `nitro({ hooks.compiled })` — the vercel preset uses that hook to write `.vercel/output/config.json` and `__server.func/.vc-config.json`. Dev mode does not need the copy — Vite SSR loads the files from `node_modules`. Sharing one preview PGlite does not remove this copy.

## 4. Application-owned database and auth files

```
app/migrations/*.sql
app/migrations-api/*.sql
app/db.server.ts              # setPgliteFactory + runMigrations + getDatabase
app/auth.server.ts            # binds Grok session → platform requireUser/getCurrentUser
app/data-api.ts               # optional 0.5.0 defineDataApi registry (application-owned)
app/mutations.ts              # 0.13.0 defineMutations registry (application-owned)
app/routes/api/platform/$.ts  # 0.6.0 catch-all → createPlatformHandler
app/routes/api/health.ts      # alias → /api/platform/health
app/routes/api/version.ts     # alias → /api/platform/version
app/routes/api/auth/$.ts      # thin adapter → Grok auth.handler
app/routes/api/data/$resource.ts  # alias → /api/platform/data/:resource
app/routes/login.tsx          # application-owned Google sign-in UI
```

Grok also requires host chrome that is **not** under `/app`:

```
src/lib/auth/**               # Better Auth instance — do not edit (except email-password.ts)
src/lib/db.ts                 # getSql() / getPglite() — do not rewrite
migrations/auth/0001_auth.sql # canonical Better Auth schema; copy to migrations/0001_auth.sql when turning sign-in on
```

Because `@/*` points at `/app/*`, the catch-all must import Grok auth with a relative path (`../../../../src/lib/auth/server`), not `@/lib/auth/server`. See `docs/AUTH.md`.

## 5. Platform distribution

`/platform` is distributed into app repositories via git subtree from this canonical upstream. Files under `/platform/**` are platform-owned and must not be hand-edited in a concrete application.

## 6. Host glue is outside the subtree

Root host glue is **not** part of the platform subtree. Platform subtree pull upgrades `/platform/**` only. Any required host-glue change must have explicit upgrade instructions (for example in `docs/UPGRADING.md` or release notes), because it will not arrive automatically with a normal platform upgrade.
