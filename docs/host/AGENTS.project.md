# Project instructions — application on grok-app-platform

Copy this file to the root of the application repository as `AGENTS.project.md`.
Grok Build's own `AGENTS.md` follows it with the same priority. These rules
override the generic "ship a demo-quality product" defaults wherever they conflict.

## What this project is

An application built on the shared platform layer in `/platform`
(upstream: `martinsakala/grok-app-platform`). It is either **mother-app**
itself (the clean base others Remix) or a Remix of it. Sign-in and a durable
database are **on**. Domain scope is defined by the user in chat, never assumed.

Remix is a one-time fork: a remixed app never receives later mother-app
changes. The only update channel is the platform via `git subtree pull`.
Therefore anything reusable across applications belongs **in the platform**,
released as a version. mother-app stays thin: Grok chrome plus thin adapters,
no test entities, no demo content.

## Never do this

- Never build, scaffold or "improve" an application feature the user did not
  ask for in this conversation. A vague prompt gets a question, not a product.
- Never edit files under `/platform/**`. Platform changes go upstream first,
  then `git subtree pull --prefix=platform platform-upstream main --squash`.
- Never edit Grok host chrome: `src/lib/auth/**` (except `email-password.ts`),
  `src/lib/db.ts`, `startup.sh`. Never create `src/routes/auth/popup.tsx`.
- Never override `hooks.compiled` in `nitro({ preset: "vercel" })`.
- Never edit a migration file that has been released. A change is a new file.
- Never write a `.env` file. Never log or return `DATABASE_URL`, tokens,
  secrets or password hashes.
- Never trust a client-supplied `user_id`, schema, table or SQL. Identity is
  `requireUser()` from `app/auth.server.ts`, nothing else.
- Never publish. The user presses Publish. Never call a production E2E "done"
  before the user confirms it.
- Never push application code to the platform upstream repository.

## Ownership zones

```
/platform/**   platform-owned   read-only here
/app/**        application-owned   routes, domain code, migrations, data-api registry
/src/**        Grok host chrome    do not put domain logic here
root files     host/build glue only
```

TanStack `srcDirectory: "app"`, alias `@/*` → `/app/*`. Import Grok chrome from
`/app` with relative paths (`../src/lib/...`), not `@/lib/...`.

## Database

- Domain tables in schema `app` via `app/migrations/000N_*.sql`.
- Published views in schema `api` via `app/migrations-api/000N_*.sql`, with
  explicit columns. A view is not readable until registered in
  `app/data-api.ts`.
- Nothing in `private` or `public` is application data.
- Pass SQL into `runMigrations` via Vite `?raw`. `setPgliteFactory(() => getPglite())`
  runs at the top of `app/db.server.ts`, before any platform DB access.
- `user_id` columns are `TEXT`. No foreign key to `public."user"`.
- Preview PGlite is ephemeral. Production is Neon Postgres provisioned by Grok;
  migrations run at first request after publish.

## Auth

- Every per-user server function: `.middleware([authMiddleware])` **and**
  `requireUser(bearerToken)` from `app/auth.server.ts`. Scope every query by
  `user.id`; use `assignOwner` on inserts.
- `/api/health`, `/api/version`, `/api/platform/health` and `/api/platform/version` stay public and secret-free.
- Mount platform HTTP at `app/routes/api/platform/$.ts`. Keep `/api/health`,
  `/api/version`, `/api/data/$resource` as aliases onto that handler.
- Login UI is application-owned (`app/routes/login.tsx`), using Grok
  `signIn("grok-google")` and `<UserButton />`. After the first sign-in,
  switch `PUT /api/platform/admin/access-policy` to `allowlist`.

## Before reporting done

- `npm run typecheck`, `npm test`, `npm run build` pass.
- `.vercel/output/config.json` exists after build; `dist/` is not expected.
- `/platform` has no local diff against the subtree.
- `git diff -- app/` contains only the change the user asked for.
- Commit locally. Push only to the repository the user names.
