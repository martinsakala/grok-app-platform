# Auth

Shared server-side identity for Grok Build applications. Platform 0.4.0 does
**not** implement OAuth. It wraps the Grok Better Auth scaffold that already
ships in every host.

## Grok Build / Better Auth

Each app runs **its own** Better Auth instance at same-origin `/api/auth/*` and
federates to the shared **Grok auth broker** (`https://auth.grok.me`, overridable
with `GROK_AUTH_ISSUER`) via the `genericOAuth` plugin.

- **Google** is the documented/supported application login capability in 0.4.0
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
import type { AuthUser } from "../platform/src/auth/index.js";

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
| `assignOwner(user, record)` | copies `record` but forces `user_id` from the session |
| `getAuthDiagnostics()` | `{ schemaReady }` — no secrets, no current user |

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
2. `AUTH_RELATIONS_EXCLUDED_FROM_DATA_API` names these four tables so a future
   generic data API must never publish them.
3. Every other platform operational table stays in `private`.
4. Application domain tables stay in `app`. Do **not** add an FK from `app.*`
   to `public."user"` — see preview limitation below.

Platform migration: `migrations/private/0002_auth.sql` (`CREATE … IF NOT EXISTS`
matching the Grok Better Auth schema). Historical files are not edited.

Grok hosts must **also** copy the scaffold file so Better Auth's own database
has the schema:

```
cp migrations/auth/0001_auth.sql migrations/0001_auth.sql
```

Do not edit that file. On production `DATABASE_URL` both appliers hit the same
Postgres; `IF NOT EXISTS` makes the overlap safe.

## Preview vs production

| | Preview (no `DATABASE_URL`) | Production |
| --- | --- | --- |
| Auth DB | Grok `src/lib/db.ts` **PGlite** | Injected `DATABASE_URL` Postgres |
| Platform DB | platform `getDatabase()` **PGlite** | Same `DATABASE_URL` Postgres |
| Persistence | Ephemeral — restart wipes users, sessions, and app rows | Durable |
| Credentials | Baked preview client, zero env files | Deployer-injected `GROK_AUTH_*` / `BETTER_AUTH_*` |
| Sign-in UX | Popup + bearer | Redirect + `__Host-` cookie |

**Two-PGlite limitation (preview only):** Grok Better Auth and the platform
database are two in-process PGlite instances. Auth tables created by platform
`0002_auth.sql` are **not** the tables Better Auth writes. Application rows
keyed by `user_id` still work because `user_id` is plain `TEXT` copied from
`requireUser().id`, with no foreign key.

Production uses one PostgreSQL database, so both appliers see the same public
auth tables.

Preview auth/session persistence is disposable. Production PostgreSQL is
persistent. Persistent PGlite is out of scope for 0.4.0.

## Thin host adapters

Grok requires a host-owned catch-all at `/api/auth/*`. The file is a one-line
forward to Grok's handler — no business logic, no token parsing.

### Required host files

```
app/routes/api/auth/$.ts     # GET/POST → auth.handler (Grok Better Auth)
app/routes/login.tsx         # application-owned Google sign-in UI
app/auth.server.ts           # binds Grok getSession to platform helpers
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
safe extra.

## Turning sign-in on in a new app

1. Delete the `VITE_AUTH_ENABLED` key from `.grok/app-env.json` and restart
   (`npm run dev` via `startup.sh` — never start Vite directly).
2. `cp migrations/auth/0001_auth.sql migrations/0001_auth.sql`.
3. Add `app/routes/api/auth/$.ts` (snippet above).
4. Add application `/login` with **Sign in with Google**.
5. Add `app/auth.server.ts` binding Grok session → platform `requireUser`.
6. Wrap per-user server functions with Grok `authMiddleware` **and** take
   identity from platform `requireUser()`.
7. Keep `user_id` columns `TEXT`. Never trust a client-supplied user id.

## What 0.4.0 does not include

API keys, audit log, generic SQL/data API, metadata API, organizations/teams,
RBAC beyond authenticated/unauthenticated, email/password, and business user
profiles.
