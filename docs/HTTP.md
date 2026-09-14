# HTTP router (0.6.0+)

`createPlatformHandler` is the platform's HTTP surface. Hosts mount it once.
New platform capabilities register routes here; they must not require a new
host file per endpoint. 0.7.0 adds POST/PUT/DELETE and access routes. 0.8.0 adds settings and the
admin audit log. **The host catch-all must list PUT and DELETE** — TanStack
Start does not forward unlisted methods, so `requiresAppChanges=false` in
0.7.0/0.8.0 was incorrect on that point. 0.9.0 adds a UI client over these
routes; it does not add HTTP routes. 0.10.0 adds public `GET /design` and
owner `PUT`/`DELETE /design`. 0.11.0 adds owner `POST /design/import`,
`GET /design/export`, `GET /design/gallery`, and optional handler
`designMarkdown`. 0.12.0 adds `?cursor=` on `GET /data/:resource` (signed
keyset; `invalid_cursor` is 400). 0.13.0 adds `GET /mutations` and
`POST /mutations/:name` (optional handler `mutations`). 0.14.0 adds
`GET /data` (registry) and `GET /data/:resource/export` (CSV / NDJSON stream;
optional handler `exportMaxRows`).

## Prefix

All platform routes live under `/api/platform`. Compatibility aliases
(`/api/health`, `/api/version`, `/api/data/:resource`) stay working because
the host rewrites those paths onto the same handler.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/platform/health` | public |
| `GET` | `/api/platform/version` | public |
| `GET` | `/api/platform/data/:resource` | principal (session or `gk_` key). Query `limit`, `offset`, `cursor` |
| `GET` | `/api/platform/data/:resource/export` | principal. Query `format=csv\|json`, `limit`. Stream. `X-Export-Truncated` when capped |
| `GET` | `/api/platform/data` | principal. `{ resources: [{ name, columns, orderBy }] }` |
| `GET` | `/api/platform/me` | principal |
| `GET` | `/api/platform/admin/users` | admin+ |
| `PUT` | `/api/platform/admin/users/:id/roles` | admin+ |
| `GET` / `PUT` | `/api/platform/admin/access-policy` | owner |
| `GET` / `POST` | `/api/platform/api-keys` | principal |
| `DELETE` | `/api/platform/api-keys/:id` | owner of the key, or admin+ |
| `GET` | `/api/platform/settings` | member+ |
| `GET` / `PUT` / `DELETE` | `/api/platform/settings/:key` | read member+; write admin+, `platform.*` owner |
| `GET` | `/api/platform/admin/audit` | admin+ |
| `GET` | `/api/platform/design` | public |
| `PUT` / `DELETE` | `/api/platform/design` | owner |
| `POST` | `/api/platform/design/import` | owner. Body `{ markdown }` or `{ preset }` |
| `GET` | `/api/platform/design/export` | owner. `text/markdown` |
| `GET` | `/api/platform/design/gallery` | owner |
| `GET` | `/api/platform/mutations` | principal. Mutations the caller can run |
| `POST` | `/api/platform/mutations/:name` | principal + mutation roles. Body = input; optional `Idempotency-Key` |
| `HEAD` / `OPTIONS` | same paths | public / same as matching GET |

Unknown **path** → `404 { "error": "Not Found", "code": "not_found" }`.
Known path, wrong method → `405 { "error": "Method Not Allowed" }` with `Allow`.
Invalid JSON or oversize body (32 KiB) → `400 { "error": "…", "code": "bad_request" }`.
Every JSON response sends `cache-control: no-store`.

## Handler

```ts
import { createPlatformHandler } from "../platform/src/http/index.js";

export const handlePlatform = createPlatformHandler({
  appConfig,
  sessionSource: (request) => sessionSourceFromRequest(request),
  dataApi,
  getDatabase,
  healthExtras: async () => ({ /* host connection snapshot */ }),
  designTokens,   // optional explicit --pf-* map; wins over designMarkdown
  designMarkdown, // optional raw design.md; tokens derived when designTokens omitted
  mutations,      // optional defineMutations({ mutations }); omit → /mutations is 404
  exportMaxRows,  // optional hard cap for data export; default 100000
});
```

`sessionSource` receives the original `Request` so the `Authorization` bearer
(preview) and cookies (production) reach Better Auth. The client may send
`user_id`, `schema`, `table`, or `sql` query params; they are ignored.
`cursor` is a signed keyset token from a previous page (`docs/DATA_API.md`).
A bad cursor is `DataApiError` `400 invalid_cursor`, never 500.

`healthExtras` is optional. Merge result is shallow-spread onto the health
payload. Use it for host-only fields such as `connection` and
`databaseShared`. Do not put secrets there.

If `dataApi` or `getDatabase` is omitted, `GET /data/:resource` and
`GET /data/:resource/export` are `404 not_found`. `GET /data` is `404`
when `dataApi` is omitted.

Export (`docs/DATA_API.md`): `format` must be `csv` or `json` (`400
invalid_input` otherwise). Body is a `ReadableStream`. Headers:
`Content-Type` `text/csv; charset=utf-8` or `application/x-ndjson`,
`Content-Disposition: attachment; filename="<resource>-<YYYYMMDD-HHmmss>.csv|ndjson"`,
`Cache-Control: no-store`. When the owner has more rows than the cap,
`X-Export-Truncated: true`. Mid-stream errors abort the stream and are
logged; they never include SQL. Setting `platform.export.max-rows` may
only lower `exportMaxRows`.

## Errors

| Thrown | Status | Body |
| --- | --- | --- |
| `UnauthorizedError` | 401 | `{ "error": "Unauthorized" }` |
| `ForbiddenError` | 403 | `{ "error": "Forbidden", "code": "forbidden" \| "not_allowed" }` |
| `BadRequestError` | 400 | `{ "error": message, "code": "bad_request" }` |
| import `DesignParseError` | 400 | `{ "error": message, "code": "invalid_design", "errors": [{ "line", "message" }] }` |
| `MutationInputError` | 400 | `{ "error": message, "code": "invalid_input", "errors": [{ "path", "message" }] }` |
| `UnknownMutationError` | 404 | `{ "error": "Mutation is not available", "code": "unknown_mutation" }` |
| `MutationError("conflict")` | 409 | `{ "error": "Conflict", "code": "conflict" }` |
| idempotency mismatch | 409 | `{ "error": "…", "code": "idempotency_mismatch" }` |
| `MutationFailedError` | 500 | `{ "error": "Mutation failed", "code": "mutation_failed" }` |
| `MethodNotAllowedError` | 405 | `{ "error": "Method Not Allowed" }` + `Allow` |
| `DataApiError` | its `status` | `{ "error": message, "code": code }` |
| anything else | 500 | `{ "error": "Internal Server Error" }` + `logError` |

500 bodies never include SQL, driver text, or connection strings. Unknown
resources are `DataApiError` `404 unknown_resource`. Access routes: see `docs/ACCESS.md`. Settings: `docs/SETTINGS.md`. Audit: `docs/AUDIT.md`. Design: `docs/DESIGN.md`. Mutations: `docs/MUTATIONS.md`. Data export: `docs/DATA_API.md`.

## Host wiring

One catch-all plus aliases — see `docs/UPGRADING.md` 0.6.0 / 0.7.0 / 0.9.0 / 0.10.0 and
`docs/HOST_LAYOUT.md`. The catch-all must forward GET, POST, PUT, DELETE,
OPTIONS, and HEAD. Login UI and `/api/auth/$` stay application-owned. Admin
pages: `docs/UI.md`.
