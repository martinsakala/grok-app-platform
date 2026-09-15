# Capability registry (0.15.0)

The platform is **headless**. The admin GUI and an LLM with an API key must
see the same description of what the deployment can do, generated from the
same handler, data-API, and mutation registries. Nothing is hand-written for
the LLM.

This file is the contract. Implementation: `src/registry`, served by
`createPlatformHandler`.

## What it is not

- Not an MCP server. The JSON registry is the **source** a future MCP adapter
  would wrap. Do not implement MCP in a host.
- Not a second copy of the HTTP API. Routes stay in `src/http/handler.ts`.
  The registry **describes** them.
- Not a dump of SQL, relation names, owner columns, `ownerEmails`, or secrets.

## Shape

`buildRegistry({ appConfig, dataApi?, mutations?, settingsKeys?, designMarkdownPresent? })`
returns:

```ts
{
  platformVersion: string;       // from VERSION
  appContractVersion: 7;         // compatibility.json, unchanged in 0.15.0
  application: { name, version };
  auth: {
    schemes: [
      { type: "apiKey", header: "Authorization", format: "Bearer gk_...", howToGet: "/admin/api-keys" },
      { type: "session" },
    ];
    roles: ["owner", "admin", "member"];
  };
  capabilities: Array<{
    id: string;                  // also OpenAPI operationId
    kind: "read" | "write" | "admin" | "design" | "settings" | "audit" | "export";
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;                // /api/platform/...
    roles: Role[];               // empty = public
    description: string;
    input: JSON Schema draft 2020-12 | null;
    output: JSON Schema | string;
    pagination?: "cursor" | null;
  }>;
}
```

Capabilities are generated:

| Source | Capabilities |
| --- | --- |
| Always | health, version, me, registry, openapi.json, llms.txt, settings, design, api-keys, admin users/policy, audit |
| Data API | `GET /data` catalog. Per resource: list + export (templates `/data/{resource}` when none registered) |
| Mutations | catalog `GET /mutations`. Per mutation: `POST /mutations/{name}` with input converted from the validator format to JSON Schema. Template `POST /mutations/{name}` when none registered |

A test introspects `listPlatformHttpRoutes()` so a new handler route without a
capability fails CI.

## How an LLM uses it (step by step)

1. `GET /api/platform/llms.txt` — short Markdown: what the app is, how to get
   a key, three curl examples, invariants.
2. Create a key at `/admin/api-keys` (member, browser session). Plaintext
   `gk_…` is shown once.
3. `GET /api/platform/registry` or `GET /api/platform/openapi.json` with
   `Authorization: Bearer gk_…` (or without, unless the host set
   `registryPublic: false`).
4. Call listed paths. List resources with `?cursor=` from `nextCursor`. POST
   mutations with optional `Idempotency-Key`.
5. Never send `user_id` as identity. Never send SQL, schema, or table names.

## HTTP

| Method | Path | Auth | Cache |
| --- | --- | --- | --- |
| `GET` | `/api/platform/registry` | public (principal if `registryPublic: false`) | `ETag`; `public, max-age=300` when public, else `no-store`. `304` on `If-None-Match` |
| `GET` | `/api/platform/openapi.json` | same | same |
| `GET` | `/api/platform/llms.txt` | same | same; `text/plain` |

OpenAPI is 3.1.0, `servers: [{ url: "/" }]`, security schemes `ApiKeyBearer`
(`Bearer gk_`) and `SessionCookie`, `operationId` = capability `id`, responses
`200` / `400` / `401` / `403` / `404` with `{ code, message }`.

`createPlatformHandler({ registryPublic: false })` flips all three to
principal-only. Default is public: the payload is a description, not data.

## Host

No new SQL. `requiresAppChanges=false`. Optional (recommended for mother-app):
mount `ApiDocsPage` at `/admin/api`. Optional: pass `settingsKeys` (names only)
and `registryPublic`.

A new capability is a registration in `app/data-api.ts` or `app/mutations.ts`.
The registry rebuilds itself. Do not hand-describe endpoints in the host.

See `docs/HTTP.md`, `docs/UI.md`, `docs/UPGRADING.md` 0.15.0.
