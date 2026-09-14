# HTTP router (0.6.0)

`createPlatformHandler` is the platform's HTTP surface. Hosts mount it once.
New platform capabilities register routes here; they must not require a new
host file per endpoint.

## Prefix

All platform routes live under `/api/platform`. Compatibility aliases
(`/api/health`, `/api/version`, `/api/data/:resource`) stay working because
the host rewrites those paths onto the same handler.

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/platform/health` | public |
| `GET` | `/api/platform/version` | public |
| `GET` | `/api/platform/data/:resource` | `requireUser` |
| `HEAD` / `OPTIONS` | same paths | public / same as GET |

Unknown method+path → `404 { "error": "Not Found", "code": "not_found" }`.
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
| `DataApiError` | its `status` | `{ "error": message, "code": code }` |
| anything else | 500 | `{ "error": "Internal Server Error" }` + `logError` |

500 bodies never include SQL, driver text, or connection strings. Unknown
resources are `DataApiError` `404 unknown_resource`.

## Host wiring

One catch-all plus aliases — see `docs/UPGRADING.md` 0.6.0 and
`docs/HOST_LAYOUT.md`. Login UI and `/api/auth/$` stay application-owned.
