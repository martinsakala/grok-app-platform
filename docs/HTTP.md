# HTTP router (0.6.0+)

`createPlatformHandler` is the platform's HTTP surface. Hosts mount it once.
New platform capabilities register routes here; they must not require a new
host file per endpoint. 0.7.0 adds POST/PUT/DELETE and access routes; the
host catch-all does not change.

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
| `MethodNotAllowedError` | 405 | `{ "error": "Method Not Allowed" }` + `Allow` |
| `DataApiError` | its `status` | `{ "error": message, "code": code }` |
| anything else | 500 | `{ "error": "Internal Server Error" }` + `logError` |

500 bodies never include SQL, driver text, or connection strings. Unknown
resources are `DataApiError` `404 unknown_resource`. Access routes: see
`docs/ACCESS.md`.

## Host wiring

One catch-all plus aliases — see `docs/UPGRADING.md` 0.6.0 / 0.7.0 and
`docs/HOST_LAYOUT.md`. Login UI and `/api/auth/$` stay application-owned.
