# Data API (0.5.0)

Safe **read-only** list of explicitly registered resources. Schema `api` is
required but **not sufficient**: nothing is published until the host registers
it.

## What 0.5.0 is

| Allowed | Not in 0.5.0 |
| --- | --- |
| `GET` list of one named resource | write, delete, RPC |
| Verified session user only | anonymous access |
| Server-enforced owner filter | client `user_id` as identity |
| Explicit column allowlist | `SELECT *` |
| Parameterized values | client SQL / schema / table names |
| Default/max page size + deterministic order | generic filter language, client joins |

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
    },
  ],
});
```

- `name` — public resource id (`kebab-case`). This is **not** a SQL identifier.
- `relation` — view/table **name only** in schema `api`. No `schema.table`.
- `columns` — returned columns. Never `*`.
- `ownerColumn` — **required**. `listResource` always adds `WHERE owner = session user.id`.
- `orderBy` / `orderDirection` — deterministic sort. `id` is appended as a tiebreaker when it is one of `columns`.

Missing `ownerColumn` fails closed at `defineDataApi`. Schema-qualified
`public.*` / `private.*` / `app.*` and Better Auth relations are rejected.
SQL identifiers are validated (`^[a-z][a-z0-9_]{0,62}$`) and quoted.

## Read

```ts
const user = await requireUser(source);
const page = await listResource(dataApi, db, {
  resource: "auth-test-items",
  user,
  limit: url.searchParams.get("limit"),
  offset: url.searchParams.get("offset"),
  user_id: url.searchParams.get("user_id"), // ignored
});
```

HTTP is **not** in this repository. Hosts add a thin adapter (typically
`GET /api/data/:resource`). Auth stay on `requireUser` / `/api/auth/*`.

## Adding a view

1. New file under `app/migrations-api/` (historical files are immutable).
2. `CREATE VIEW api.<relation> AS SELECT <explicit columns> FROM app.<table>`.
3. Pass the SQL into `runMigrations({ apiMigrations })` via Vite `?raw`.
4. Register the resource. An unregistered `api.*` view is not readable.

## Errors

`DataApiError` (`status`, `code`, generic `message`). `UnauthorizedError` when
there is no session. Messages never include SQL, connection strings, or schema
dumps.

| code | status | when |
| --- | --- | --- |
| `invalid_input` | 400 | bad resource name or page params |
| `invalid_identifier` | 400 | bad SQL identifier at registration |
| `forbidden` | 403 | public/private/app or denylisted relation |
| `unknown_resource` | 404 | not on the allowlist |
| `query_failed` | 500 | driver error (details discarded) |

## Upgrade vs capability

Subtree-pulling 0.5.0 does **not** require application changes. Existing 0.4.2
hosts keep working. Enabling the data API is a separate host step: view +
registry + GET adapter. See `docs/UPGRADING.md`.
