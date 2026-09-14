# Access: principals, roles, allowlist, API keys (0.7.0)

Identity is still Grok Better Auth. 0.7.0 adds a **principal** on top of that
session (or an API key), a small role model, an allowlist, and hashed API keys.
There is no admin UI.

```
Client-provided user_id is never an authorization authority.
```

## Principal

```ts
type Role = "owner" | "admin" | "member";

type Principal =
  | { kind: "user"; user: AuthUser; roles: Role[] }
  | { kind: "api-key"; keyId: string; name: string; ownerUserId: string; roles: Role[] };
```

`requirePrincipal(source, request?)` resolves in this order:

1. `Authorization: Bearer gk_…` → API key (see below). Invalid / revoked key → 401.
2. Otherwise the existing `AuthSessionSource` (cookie or preview bearer) → user.
3. No identity → `UnauthorizedError` (401).

Other Bearer values (preview session tokens) are not treated as keys.

`requireUser` is unchanged. Data API `listResource` and `assignOwner` /
`ownerIdFromSession` accept `Principal` or `AuthUser`. For an API key the
owner id is `ownerUserId`.

`GET /api/platform/me` returns kind, roles, and either `{ user: { id, email, name } }`
or `{ keyId, keyName }`. No tokens, hashes, or secrets.

## Roles

`owner` ⊇ `admin` ⊇ `member`. `hasRole` / `requireRole` use that rank, not an
exact string match: an owner satisfies an admin check.

| Action | Who |
| --- | --- |
| First authenticated user | `owner` (atomic; see bootstrap) |
| Later users who pass the allowlist | `member` |
| `listUsers` / `setRoles` | admin+ |
| `getAccessPolicy` / `setAccessPolicy` | owner |
| Create / list own API keys | any principal |
| List all API keys / revoke another user's key | admin+ |

`setRoles` replaces the target's role set. An **admin cannot change an owner**
(grant or revoke `owner`, or edit a user who currently has `owner`). The
**last owner cannot be removed**.

## Bootstrap

The first `requirePrincipal` that succeeds as a **user** on an empty
`private.user_roles` inserts `owner` for that user. Two concurrent first
requests are serialized with `SELECT … FOR UPDATE` on `private.access_policy`
(id = 1), so only one owner is created. Later users get `member` if the
allowlist allows them.

Default policy after `0003_access.sql`: `mode = 'open'`. That is deliberate so
mother-app does not lock itself out. **The first step on a new application
after the first sign-in is to switch the policy to `allowlist`.**

## Allowlist

Stored in `private.access_policy` (single row, id = 1).

| Mode | Who may receive a first role |
| --- | --- |
| `open` | anyone who authenticates |
| `allowlist` | email (lowercase) in `allowed_emails`, or domain after `@` in `allowed_domains` |

The **owner always passes**, even when their email is not on the list. The
allowlist is checked only when granting the first role; existing role-holders
are not re-checked on every request. Denial is `ForbiddenError` 403
`{ "error": "Forbidden", "code": "not_allowed" }`. Other permission failures
use `code: "forbidden"`.

```http
PUT /api/platform/admin/access-policy
{ "mode": "allowlist", "allowed_emails": ["you@example.com"], "allowed_domains": ["example.com"] }
```

Owner-only. Invalid `mode` is 400.

## API keys

Format: `gk_` + 32 random bytes as base64url. `prefix` is the first 8 characters
after `gk_`. The database stores a SHA-256 hex **hash** of the full plaintext;
plaintext is returned **once**, in the create response field `key`. Rotation is
revoke + create. The key and hash are never logged.

`createApiKey(principal, { name, roles })` — requested roles must not exceed
the creator's rank (an owner may mint `owner` / `admin` / `member`; a member
may only mint `member`). A key authenticates as `kind: "api-key"` with
`ownerUserId` of the creator. Data API rows are scoped to that owner.

`listApiKeys` returns own keys, or all keys for admin+. `revokeApiKey` sets
`revoked_at`; lookup of a revoked key is 401. `last_used_at` is updated without
blocking the request.

## HTTP

All under `/api/platform` via `createPlatformHandler` (no extra host files).

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/me` | principal |
| `GET` | `/admin/users` | admin+ |
| `PUT` | `/admin/users/:id/roles` | admin+ |
| `GET` / `PUT` | `/admin/access-policy` | owner |
| `GET` / `POST` | `/api-keys` | principal (POST returns `key` once) |
| `DELETE` | `/api-keys/:id` | owner of the key, or admin+ |
| `GET` | `/data/:resource` | principal (session or `gk_` key) |

JSON bodies are limited to 32 KiB; invalid JSON → 400 `{ "error": "…", "code": "bad_request" }`.
Known path, wrong method → 405 `{ "error": "Method Not Allowed" }` with `Allow`.

### First key (owner, after sign-in)

Preview uses `Authorization: Bearer <session>` from Grok. Production uses the
session cookie.

```bash
# create (session cookie or preview bearer)
curl -sS -X POST https://APP.grok.me/api/platform/api-keys \
  -H 'content-type: application/json' \
  -H 'cookie: __Host-grok-auth.session_token=…' \
  -d '{"name":"ci","roles":["member"]}'
# → { "id", "name", "prefix", "roles", "key": "gk_…", … }   # store `key` now

# use
curl -sS https://APP.grok.me/api/platform/me \
  -H 'authorization: Bearer gk_…'
```

Then switch the policy:

```bash
curl -sS -X PUT https://APP.grok.me/api/platform/admin/access-policy \
  -H 'content-type: application/json' \
  -H 'cookie: __Host-grok-auth.session_token=…' \
  -d '{"mode":"allowlist","allowed_emails":["you@example.com"],"allowed_domains":[]}'
```

## Security model

* Schema `private` is not a data-API surface. `public."user"` is still the
  Better Auth exception; there is **no FK** from `user_roles` or `api_keys` to
  it.
* Roles live in `private.user_roles`. Policy lives in `private.access_policy`.
  Keys live in `private.api_keys` (hash unique; plaintext never stored).
* Identity for data is `ownerIdOf(principal)`, never a client `user_id`.
* `0003_access.sql` is a new platform migration. Do not edit `0001` / `0002`.
