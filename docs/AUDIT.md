# Audit log (0.8.0)

Append-only rows in `private.audit_log`. There is **no retention job** in this
release: the table grows until the operator truncates or archives it. Document
that before relying on it for compliance.

## Write API

```ts
import { audit } from "../platform/src/audit/index.js";

await audit(principal, {
  action: "settings.set",
  entity: "setting",
  entityId: "app.theme",
  meta: { key: "app.theme" },
});
```

- `principal_kind` is `user` or `api-key`. `principal_id` is the user id or
  key id (never the `gk_` plaintext). `principal_label` is email or key name.
- `meta` is JSON after the logger redaction plus extra redaction of
  `hash` / `api_key` / token-like keys. A write failure is **logged and
  swallowed** — it must not fail the originating request.

## Automatic events

| Action | When |
| --- | --- |
| `owner.bootstrap` | listed `ownerEmails` or first-user owner |
| `member.auto` | a new user becomes `member` |
| `roles.set` | `setRoles` |
| `access_policy.set` | `setAccessPolicy` |
| `api_key.create` / `api_key.revoke` | key issued or revoked (prefix + name, never plaintext) |
| `settings.set` / `settings.delete` | setting written or deleted |
| `design.set` | owner saved or reset `platform.design` |
| `design.import` | owner imported markdown or a gallery preset |
| `mutation.<name>` | `POST /mutations/:name` (every authenticated attempt) |

Existing owner `/me` calls are not logged.

## HTTP

`GET /api/platform/admin/audit` — **admin+**.

Query:

- `limit` 1–100 (default 50)
- `before` = last `id` from the previous page (cursor, `id desc`)
- `action`, `entity`, `entity_id`, `principal_id` (exact match)

Response: `{ "entries": [...], "nextBefore": number | null }`.
`nextBefore` is set when the page is full. OFFSET is not used.

This is not a consistent snapshot: concurrent inserts can appear on a later
page. No secrets in the payload.

Unsigned → `401`. `member` → `403`. Invalid `limit`/`before` → `400`.

`mutation.<name>` meta is `{ outcome, inputSha256, requestId, principalKind, principalId }`.
`outcome` is `ok` | `invalid_input` | `forbidden` | `failed` | `conflict` |
`replayed`. The request body is never stored. See `docs/MUTATIONS.md`.
