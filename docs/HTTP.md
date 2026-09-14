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
`designMarkdown`.

## Prefix

All platform routes live under `/api/platform`. Compatibility aliases
(`/api/health`, `/api/version`, `/api/data/:resource`) stay working because
the host rewrites those paths onto the same handler.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/platform/health` | public |
| `GET` | `/api/platform/version` | public |
| `GET` | `/api/platform/data/:resource` | principal (session or `gk_` key) |
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
});
```

`sessionSource` receives the original `Request` so the `Authorization` bearer
(preview) and cookies (production) reach Better Auth. The client may send
`user_id`, `schema`, `table`, or `sql` query params; they are ignored.

`healthExtras` is optional. Merge result is shallow-spread onto the health
payload. Use it for host-only fields such as `connection` and
`databaseShared`. Do not put secrets there.

If `dataApi` or `getDatabase` is omitted, `GET /data/:resource` is `404
not_found`.

## Errors

| Thrown | Status | Body |
| --- | --- | --- |
| `UnauthorizedError` | 401 | `{ "error": "Unauthorized" }` |
| `ForbiddenError` | 403 | `{ "error": "Forbidden", "code": "forbidden" \| "not_allowed" }` |
| `BadRequestError` | 400 | `{ "error": message, "code": "bad_request" }` |
| import `DesignParseError` | 400 | `{ "error": message, "code": "invalid_design", "errors": [{ "line", "message" }] }` |
| `MethodNotAllowedError` | 405 | `{ "error": "Method Not Allowed" }` + `Allow` |
| `DataApiError` | its `status` | `{ "error": message, "code": code }` |
| anything else | 500 | `{ "error": "Internal Server Error" }` + `logError` |

500 bodies never include SQL, driver text, or connection strings. Unknown
resources are `DataApiError` `404 unknown_resource`. Access routes: see `docs/ACCESS.md`. Settings: `docs/SETTINGS.md`. Audit: `docs/AUDIT.md`. Design: `docs/DESIGN.md`.

## Host wiring

One catch-all plus aliases — see `docs/UPGRADING.md` 0.6.0 / 0.7.0 / 0.9.0 / 0.10.0 and
`docs/HOST_LAYOUT.md`. The catch-all must forward GET, POST, PUT, DELETE,
OPTIONS, and HEAD. Login UI and `/api/auth/$` stay application-owned. Admin
pages: `docs/UI.md`.
