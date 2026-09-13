# Instructions for coding agents

* This repository is the canonical upstream for the shared platform layer.

* Do not implement application features here.

* Fix generic/platform bugs in this repository.

* Concrete applications must not patch their local copy of `/platform`.

* If an app needs a new platform capability, the change is made here first; the application then upgrades its platform copy.

## Ownership zones (downstream apps)

```
/platform/** = platform-owned
/app/**      = application-owned
root host glue = host-owned
```

* Business/domain logic must not live in root host glue.
* Platform runtime logic must not be duplicated in root host glue.
* Application source uses TanStack `srcDirectory: "app"`.
* Alias `@/*` points to `/app/*`.
* Generated `app/routeTree.gen.ts` is application-owned generated artifact.
* Change root host glue only when Grok/TanStack/deploy integration requires it.
* Platform upgrades must not routinely change `/app/**`.
* Application features must not routinely change `/platform/**`.
* Root glue changes must be explicit and documented; they are not part of the git subtree.

## Database rules

* Applications must not create domain tables in `private`.
* The platform must not create domain tables in `app`.
* `api` contains only objects the application explicitly publishes (views/functions), never a dump of `app`.
* A future generic data API is a **positive allowlist on schema `api` only**. Never auto-publish `public`, `private`, or `app`.
* Downstream apps must not patch platform DB implementation (`platform/src/database/**`).
* DB capability changes are made upstream, then pulled via `git subtree pull`.
* Historical migration files are immutable after release; a new change is a new migration file.
* Import `platform/src/database` only from server-side host code.
* Do not import the runtime barrel from client components if that would pull `getHealthResponse` / database into the browser bundle.
* Hosts must call `setPgliteFactory(() => getPglite())` from server-only boot **before** `getDatabase()` / `runMigrations()`, so preview Better Auth and platform share Grok's PGlite. Do not import host `src/lib/db.ts` from `/platform`.
* Do not replace the production `pg` Pool with Grok `getSql()`: `getSql()` cannot hold a session across per-file transactions or take a session-level advisory lock.
* Production `DATABASE_URL` may be a transaction pooler (Neon `-pooler`). `runMigrations` must use a session-capable URL (`DATABASE_URL_UNPOOLED` / `DIRECT_URL` / `POSTGRES_URL_NON_POOLING`, or the documented Neon `-pooler` hostname rewrite). Do not blindly rewrite other hostnames. A local `pg.Pool` is not a Postgres session when the URL is pooled.


## Auth rules

* Client-provided `user_id` is never an authorization authority.
* Trusted identity comes only from the verified server-side session (`requireUser` / `getCurrentUser`).
* Do not implement custom OAuth or parse Google tokens in the application. Wrap Grok Better Auth.
* Do not edit host `src/lib/auth/` except `email-password.ts`.
* Do not create `src/routes/auth/popup.tsx`.
* Better Auth identity tables live in `public` (Grok/Better Auth exception). Canonical schema owner is Grok `migrations/auth/0001_auth.sql`. Platform `0002_auth.sql` is a historical compatibility bootstrap — do not edit it and do not add further Better Auth column-copy migrations.
* Never log or return access tokens, refresh tokens, session tokens, OAuth secrets, or password hashes.
* `/api/health` and `/api/version` stay public; an unsigned-in visitor is not degraded.
* Import `platform/src/auth` only from server-side host code. Login UI is application-owned.
* `getAuthDiagnostics()` probes `getDatabase()`. After `setPgliteFactory` that is the real Better Auth schema.
