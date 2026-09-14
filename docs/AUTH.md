# Auth

Shared server-side identity for Grok Build applications. Platform 0.4.x does
**not** implement OAuth. It wraps the Grok Better Auth scaffold that already
ships in every host.

## Grok Build / Better Auth

Each app runs **its own** Better Auth instance at same-origin `/api/auth/*` and
federates to the shared **Grok auth broker** (`https://auth.grok.me`, overridable
with `GROK_AUTH_ISSUER`) via the `genericOAuth` plugin.

- **Google** is the documented/supported application login capability
  (provider id `grok-google`, broker `idp=google`).
- The Grok scaffold also wires **X**. Do not remove it from `GROK_PROVIDERS`;
  do not add other providers.
- Email/password stays off (`src/lib/auth/email-password.ts`).
- Do **not** edit files under host `src/lib/auth/` except that one flag.
- Do **not** create `src/routes/auth/popup.tsx` — the Vite `authPopupPlugin`
  already serves the live-preview popup.

Better Auth version in current Grok hosts: `better-auth@1.6.30`.

The platform repository has **no** `better-auth` dependency. Identity helpers
are pure; the host binds them to Grok's `auth.api.getSession`.

## How Google sign-in works

1. The visitor clicks **Sign in with Google** on the application `/login` page.
2. The browser calls `signIn("grok-google")` from host `src/lib/auth/client`.
3. **Live preview** (`*.grok-sandbox.com` iframe): a popup opens `/auth/popup`,
   which 302s to the broker. Preview uses a baked shared client
   (`src/lib/auth/preview.ts`). On return the popup posts a session **bearer**
   because iframe cookies are partitioned.
4. **Deployed**: a full-page redirect to the broker. The deployer injects
   `GROK_AUTH_CLIENT_ID` / `GROK_AUTH_CLIENT_SECRET` / `BETTER_AUTH_URL` /
   `BETTER_AUTH_SECRET` / `DATABASE_URL`. Never write a `.env` file.
5. The broker forwards to Google (`prompt=select_account`). This app never
   sees Google client secrets or upstream access tokens.
6. Better Auth mints a **local** session (`__Host-grok-auth.session_token`).
7. Server code resolves identity with `requireUser()` / `getCurrentUser()`.

Behind the Grok edge gate, `x-grok-identity` can materialize a session with
zero clicks. That is Grok chrome, not this platform. Do not render a sign-in
button to a gate viewer; use `<SignInGate>`.

## Server-side identity

```ts
export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};
```

| Helper | Result |
| --- | --- |
| `getCurrentUser(source)` | `AuthUser` or `null` |
| `requireUser(source)` | `AuthUser`, or `UnauthorizedError` (401, message `"Unauthorized"`) |
| `getCurrentSession(source)` | `{ user, expiresAt }` or `null` — **no session token** |
| `ownerIdFromSession(user, client?)` | always `user.id`; ignores `client.user_id` |
| `assignOwner(user, record)` | copies `record` but forces `user_id` from the session (`AuthUser` or `Principal`) |
| `getAuthDiagnostics()` | `{ schemaReady }` — no secrets, no current user |
| `requirePrincipal(source, request?, appConfig?)` | `Principal` (user + roles, or API key); 401 without identity. `appConfig.ownerEmails` drives owner bootstrap. |

`requireUser` is unchanged and still the session-only helper. Prefer
`requirePrincipal` when a route should accept an API key as well. See
`docs/ACCESS.md`.

`requireUser` / `getCurrentUser` **do not take a user id argument**. A body
like `{ "user_id": "abc" }` is never an authorization authority.

```
Client-provided user_id is never an authorization authority.
```

Trusted identity comes only from the verified server-side session.

Raw Better Auth fields (`accessToken`, `refreshToken`, `idToken`, `token`,
`password`, `emailVerified`, …) are stripped by `toAuthUser` and must not
appear in logs, `/api/health`, or `/api/version`.

## Database placement

**Preferred** would be `private.user` / `private.session` / … Better Auth 1.6.x
as wired by Grok does **not** support a non-default PostgreSQL schema. It
queries quoted camelCase names in `public`:

```
public."user"
public."session"
public."account"
public."verification"
```

This is an explicit, documented exception:

1. Auth stays on the native Grok integration (no SQL rewrite hack).
2. A future generic data API is a **positive allowlist on schema `api` only**.
   `public`, `private`, and `app` are never auto-published.
   `AUTH_RELATIONS_EXCLUDED_FROM_DATA_API` is defense-in-depth, not the primary
   boundary.
3. Every other platform operational table stays in `private`.
4. Application domain tables stay in `app`. Do **not** add an FK from `app.*`
   to `public."user"`.

### Canonical owner of the Better Auth schema

```
Grok/Better Auth native migrations = canonical auth schema
platform auth wrapper             = identity contract, not a second generator
```

- **Canonical file:** host `migrations/auth/0001_auth.sql` (Better Auth CLI
  Postgres adapter). Copy to `migrations/0001_auth.sql` when turning sign-in
  on. **Do not edit.**
- **Platform `migrations/private/0002_auth.sql`:** historical 0.4.0
  compatibility bootstrap (`IF NOT EXISTS` of the same tables). **Do not
  edit.** Do not add later platform migrations that copy new Better Auth
  internal columns.

On a shared database both appliers are safe because of `IF NOT EXISTS`.

## Preview vs production

Hosts **must** call `setPgliteFactory(() => getPglite())` from server-only boot
before `getDatabase()` / `runMigrations()`.

| | Preview (no `DATABASE_URL`) | Production |
| --- | --- | --- |
| Auth DB | Grok `getPglite()` | Injected `DATABASE_URL` Postgres (Better Auth `pg` Pool) |
| Platform DB | **same** Grok PGlite (injected) | Platform `pg` Pool on the **same** `DATABASE_URL` for queries; `runMigrations` uses a session-capable URL when `DATABASE_URL` is pooled |
| Persistence | Ephemeral — restart wipes users, sessions, and app rows | Durable |
| Credentials | Baked preview client, zero env files | Deployer-injected `GROK_AUTH_*` / `BETTER_AUTH_*` |
| Sign-in UX | Popup + bearer | Redirect + `__Host-` cookie |

Production uses one PostgreSQL database and three query pools (Better Auth, Grok
`getSql()`, platform `getDatabase()`) on `DATABASE_URL`. That URL may be a
transaction pooler. `runMigrations` uses a session-capable connection so
`pg_advisory_lock` survives per-file COMMIT (see `docs/DATABASE.md`). Grok
`getSql()` cannot hold a session.


Preview auth/session persistence is disposable. Production PostgreSQL is
persistent. Persistent PGlite is out of scope.

## Why not wrap Grok `getSql()` as the platform driver

`getSql()` is a parameterized `query()` that returns `rows[]`. It does not
expose:

* multi-statement `exec` (platform migration files are whole SQL scripts);
* `transaction()`;
* a held backend session / `PoolClient`.

Neon pooled endpoints also keep no session state. The 0.3.1 runner requires
one session-level advisory lock across per-file transactions. Replacing the
platform Pool with `getSql()` would drop that guarantee. Preview unifies via
`getPglite()` (single connection, transactions, `exec`) instead.

## Thin host adapters

Grok requires a host-owned catch-all at `/api/auth/*`. The file is a one-line
forward to Grok's handler — no business logic, no token parsing.

### Required host files

```
app/routes/api/auth/$.ts     # GET/POST → auth.handler (Grok Better Auth)
app/routes/login.tsx         # application-owned Google sign-in UI
app/auth.server.ts           # binds Grok getSession to platform helpers
app/db.server.ts             # setPgliteFactory(() => getPglite()) then runMigrations
```

Because this host uses TanStack `srcDirectory: "app"` and `@/*` → `/app/*`,
**do not** import `@/lib/auth/server`. Import Grok chrome with a relative path:

```ts
// app/routes/api/auth/$.ts
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../../src/lib/auth/server";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
```

```ts
// app/db.server.ts (preview sharing — call before getDatabase)
import { getPglite } from "../src/lib/db";
import { setPgliteFactory } from "../platform/src/database/index.js";

setPgliteFactory(() => getPglite());
```

```ts
// app/auth.server.ts (pattern)
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "../../src/lib/auth/server";
import {
  createAuthSessionSource,
  getCurrentSession as platformGetCurrentSession,
  getCurrentUser as platformGetCurrentUser,
  requireUser as platformRequireUser,
} from "../platform/src/auth/index.js";

function grokSource(bearerToken?: string) {
  return createAuthSessionSource({
    async getSession() {
      const request = getRequest();
      if (!request) return null;
      const headers = bearerToken
        ? new Headers(request.headers)
        : request.headers;
      if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);
      return auth.api.getSession({ headers });
    },
  });
}

export const getCurrentUser = (bearerToken?: string) =>
  platformGetCurrentUser(grokSource(bearerToken));
export const requireUser = (bearerToken?: string) =>
  platformRequireUser(grokSource(bearerToken));
export const getCurrentSession = (bearerToken?: string) =>
  platformGetCurrentSession(grokSource(bearerToken));
```

Pass `context.bearerToken` from Grok `authMiddleware` into these helpers so
live-preview partitioned cookies still resolve. Scope every per-user query with
`requireUser().id` (or `ownerIdFromSession` / `assignOwner`), **not** a client
field.

Login UI is **application-owned**. Use `signIn("grok-google")` and
`<UserButton />` from Grok `src/lib/auth`. The platform does not ship React
components.

## Health and version

`/api/health` and `/api/version` stay public. An unsigned-in visitor is not
degraded. Do not put auth configuration, credentials, or the current user in
those payloads. `getAuthDiagnostics()` may add `{ schemaReady: boolean }` as a
safe extra. After `setPgliteFactory`, `schemaReady` is the real Better Auth
schema on the shared preview (or production) database.

## Turning sign-in on in a new app

1. Delete the `VITE_AUTH_ENABLED` key from `.grok/app-env.json` and restart
   (`npm run dev` via `startup.sh` — never start Vite directly).
2. `cp migrations/auth/0001_auth.sql migrations/0001_auth.sql`.
3. Add `app/routes/api/auth/$.ts` (snippet above).
4. Add application `/login` with **Sign in with Google**.
5. Add `app/auth.server.ts` binding Grok session → platform `requireUser`.
6. Call `setPgliteFactory(() => getPglite())` from `app/db.server.ts`.
7. Wrap per-user server functions with Grok `authMiddleware` **and** take
   identity from platform `requireUser()`.
8. Keep `user_id` columns `TEXT`. Never trust a client-supplied user id.

## What this module still does not include

Audit log, generic SQL, metadata API, organizations/teams, email/password,
and business user profiles. Roles, allowlist, and API keys are in 0.7.0
(`docs/ACCESS.md`). `requireUser` remains the session-only helper.
