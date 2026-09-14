# Data API (0.5.1 / 0.12.0)

Safe **read-only** list of explicitly registered resources. Schema `api` is
required but **not sufficient**: nothing is published until the host registers
it.

## What 0.5.x / 0.12.0 is

| Allowed | Not in 0.5.x / 0.12.0 |
| --- | --- |
| `GET` list of one named resource | write, delete, RPC |
| Verified session user or API key | anonymous access |
| Server-enforced owner filter | client `user_id` as identity |
| Explicit column allowlist | `SELECT *` |
| Parameterized values | client SQL / schema / table names |
| Default/max page size + unique `ORDER BY` | generic filter language, client joins |
| Offset pages **and** signed keyset `cursor` (0.12.0) | snapshot isolation of the list |

0.5.1 does **not** add product features or change auth. It makes list order
unique without requiring the unique column to be returned. 0.12.0 adds
opaque keyset cursors on top of that order. `appContractVersion` stays 6.

## Registration

Host (application) code, never `/platform`:

```ts
import { defineDataApi, listResource } from "../platform/src/data-api/index.js";

export const dataApi = defineDataApi({
  resources: [
    {
      name: "auth-test-items",
      relation: "auth_test_items",
      columns: ["id", "user_id", "value", "created_at"],
      ownerColumn: "user_id",
      orderBy: "created_at",
      orderDirection: "desc",
      uniqueBy: "id",
    },
  ],
});
```

- `name` — public resource id (`kebab-case`). This is **not** a SQL identifier.
- `relation` — view/table **name only** in schema `api`. No `schema.table`.
- `columns` — returned columns. Never `*`. The unique sort key does **not**
  have to be listed here.
- `ownerColumn` — **required**. `listResource` always adds `WHERE owner = session user.id`.
- `orderBy` / `orderDirection` — primary sort column and direction.
- `uniqueBy` — column that makes the order unique **at least among one
  owner's rows** on the published view. Used in `ORDER BY` even when it is
  not in `columns`. The application owns this invariant; naming a column
  `id` does not prove uniqueness.

### Compatibility (implicit `id`)

If `uniqueBy` is omitted **and** `id` is one of `columns`, 0.5.1 uses `id` as
the unique key (0.5.0 host registrations keep working). Any other omitted
configuration is **rejected at `defineDataApi`**. 0.5.0 accepted those
registrations and paginated with a non-unique `ORDER BY`; that was a bug,
not a supported contract.

`ORDER BY` is `orderBy`, then `uniqueBy` when they differ. Same direction on
both. Values are parameterized; identifiers are validated and quoted.

## Cursor pagination (0.12.0)

`listResource` accepts `cursor` (string) next to `limit`. When `cursor` is
set, `offset` is **ignored** and the response `offset` is `0`.

The token is opaque: `base64url(JSON).base64url(HMAC-SHA256)` where JSON is
`{ v: 1, r: resource name, o: orderBy value, u: uniqueBy value }`. Dates
serialize as ISO-8601, bigints as decimal strings. Comparison uses a
row-value predicate on the registry identifiers only:

```sql
WHERE owner = $1 AND (orderBy, uniqueBy) > ($o, $u)   -- ASC
WHERE owner = $1 AND (orderBy, uniqueBy) < ($o, $u)   -- DESC
```

`uniqueBy` is selected internally even when it is not in `columns`; it is
stripped from `items` unless the host listed it.

HMAC key is SHA-256(`grok-app-platform:data-api:cursor:v1` ‖ `DATABASE_URL`)
when the URL is set, otherwise a random per-process key. **The key and its
derivation are never logged.** A cursor is valid only for the **same
resource** on the **same deployment** (same URL, or same process when the
URL is absent). A malformed, unsigned, foreign-resource, or other-deployment
cursor is `400 { code: "invalid_cursor" }` — never `500`.

Response:

```ts
{ items, limit, nextCursor: string | null, offset }
```

`nextCursor` is `null` when `items.length < limit`. Offset remains for old
clients; adding `nextCursor` is additive.

```ts
const page = await listResource(dataApi, db, {
  resource: "auth-test-items",
  user,
  limit: url.searchParams.get("limit"),
  cursor: url.searchParams.get("cursor"),
  offset: url.searchParams.get("offset"), // ignored when cursor is set
});
```

HTTP: `GET /api/platform/data/:resource?cursor=&limit=` (session or `gk_`
key, same as before). Client: `listData(resource, { limit, cursor })`.

## Stable order vs consistent snapshot

A unique `ORDER BY` means that **for a frozen set of rows** OFFSET pages do
not skip or duplicate. Concurrent inserts, updates, and deletes can still
cause OFFSET pagination to skip or repeat rows.

Keyset `cursor` pagination (0.12.0) does not skip or duplicate **already
returned** keys when a row is inserted behind the cursor. A row inserted
*ahead* of the cursor appears on a later page; a row inserted *behind* it
is not replayed. This is still **not** snapshot isolation of the list: a
deleted row disappears, an updated sort key can move. Prefer `cursor` for
walks; keep `offset` only for old clients.

## Read

```ts
const user = await requireUser(source);
const page = await listResource(dataApi, db, {
  resource: "auth-test-items",
  user,
  limit: url.searchParams.get("limit"),
  cursor: url.searchParams.get("cursor"),
  offset: url.searchParams.get("offset"),
  user_id: url.searchParams.get("user_id"), // ignored
});
```

HTTP since 0.6.0 is `GET /api/platform/data/:resource` (query `limit`,
`offset`, `cursor`) via `createPlatformHandler`. Host aliases keep
`/api/data/:resource`. Auth stay on `requirePrincipal` / `/api/auth/*`.
Client `user_id` / schema / table / sql query params are ignored.

## Adding a view

1. New file under `app/migrations-api/` (historical files are immutable).
2. `CREATE VIEW api.<relation> AS SELECT <explicit columns> FROM app.<table>`.
   Include the unique key on the view even if the resource does not return it.
3. Pass the SQL into `runMigrations({ apiMigrations })` via Vite `?raw`.
4. Register the resource. An unregistered `api.*` view is not readable.

## Errors

`DataApiError` (`status`, `code`, generic `message`). `UnauthorizedError` when
there is no session. Messages never include SQL, connection strings, or schema
dumps.

| code | status | when |
| --- | --- | --- |
| `invalid_input` | 400 | bad resource name or page params |
| `invalid_cursor` | 400 | malformed, unsigned, or foreign-resource cursor |
| `invalid_identifier` | 400 | bad SQL identifier at registration |
| `forbidden` | 403 | public/private/app or denylisted relation |
| `unknown_resource` | 404 | not on the allowlist |
| `query_failed` | 500 | driver error (details discarded) |

Missing `ownerColumn` / `uniqueBy` (when `id` is not in `columns`) throws at
`defineDataApi` so the process fails closed.

## Upgrade vs capability

Subtree-pulling 0.5.1 does **not** require application changes for hosts that
already return `id`. Enabling the data API is still a separate host step:
view + registry + GET adapter. Resources without `id` in `columns` must set
`uniqueBy`. See `docs/UPGRADING.md`.
