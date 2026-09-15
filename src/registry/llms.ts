import type { PlatformRegistry } from "./types.js";

function firstOf(registry: PlatformRegistry, prefix: string) {
  return registry.capabilities.find((item) => item.id.startsWith(prefix) && !item.path.includes("{"));
}

function templateOf(registry: PlatformRegistry, id: string) {
  return registry.capabilities.find((item) => item.id === id);
}

/**
 * Short Markdown a model can read instead of source code.
 * No secrets, no SQL, no connection strings.
 */
export function buildLlmsTxt(registry: PlatformRegistry): string {
  const resource =
    firstOf(registry, "data.list.") ?? templateOf(registry, "data.list");
  const mutation =
    registry.capabilities.find((item) => item.id.startsWith("mutation.") && item.method === "POST" && !item.path.includes("{")) ??
    templateOf(registry, "mutation.run");
  const resourcePath = resource?.path ?? "/api/platform/data/{resource}";
  const mutationPath = mutation?.path ?? "/api/platform/mutations/{name}";
  const mutationBody = mutation && typeof mutation.input === "object" && mutation.input?.properties
    ? JSON.stringify(
        Object.fromEntries(
          Object.keys((mutation.input.properties as Record<string, unknown>) ?? {}).map((key) => [key, `…${key}`]),
        ),
      )
    : '{"field":"value"}';

  return `# ${registry.application.name}

Platform ${registry.platformVersion} (appContractVersion ${registry.appContractVersion}).
This API is headless: the GUI and an LLM with an API key share one implementation.

## Auth

1. Sign in as a member at the app.
2. Open /admin/api-keys and create a key (plaintext \`gk_…\` shown once).
3. Send \`Authorization: Bearer gk_…\` on every request. A browser session cookie also works.

Roles: owner ⊇ admin ⊇ member.

## Discovery

- GET /api/platform/registry — JSON capabilities
- GET /api/platform/openapi.json — OpenAPI 3.1
- GET /api/platform/llms.txt — this file

## Invariants

- A client-supplied \`user_id\` is never authorization. Identity is the verified principal.
- Data API rows are owner-scoped to the session user or the API key's owner.
- Do not send SQL, schema, or table names. Resources are named allowlist entries.
- Do not log or echo the API key.

## Examples

Current principal:

\`\`\`
curl -sS -H "Authorization: Bearer $API_KEY" /api/platform/me
\`\`\`

List a resource with a cursor:

\`\`\`
curl -sS -H "Authorization: Bearer $API_KEY" "${resourcePath}?limit=50&cursor=CURSOR"
\`\`\`

Run a mutation (optional Idempotency-Key):

\`\`\`
curl -sS -X POST \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: unique-request-id" \\
  -d '${mutationBody}' \\
  ${mutationPath}
\`\`\`
`;
}
