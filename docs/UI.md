# UI zone (0.9.0)

The platform owns admin pages, layout shells, and a typed HTTP client.
The host mounts them. The host does not reimplement fetch, tables, or role
gating. Navigation stays in the host: pass `href` and optional `onNavigate`.
Do not import a router from this package.

## Peer expectations

The host already has React 19, `react-dom`, and Tailwind v4. This package
lists `react` / `react-dom` as **peerDependencies** and as **devDependencies**
so `npm run typecheck` / `vitest` work in this repository. Do not add extra UI
libraries here; lucide-react and Radix stay host-owned if the app uses them.

## Client

```ts
import { createPlatformClient, PlatformClientError } from "../platform/src/ui/index.js";

export const platformClient = createPlatformClient({
  baseUrl: "/api/platform",
  // Optional. Same-origin cookie auth needs no bearer.
  getBearer: () => undefined,
});
```

Typed methods cover every 0.8.0 route plus 0.10.0/0.11.0 design: `me`, `health`, `version`,
`listUsers` / `setUserRoles`, `getAccessPolicy` / `setAccessPolicy`,
`listApiKeys` / `createApiKey` / `revokeApiKey`, `listSettings` /
`getSetting` / `setSetting` / `deleteSetting`, `listAudit`,
`listData(resource, { limit, offset, cursor })`,
`getDesign` / `setDesign` / `resetDesign` / `importDesign` / `exportDesign` /
`listDesignGallery`, `listMutations` / `runMutation(name, input, { idempotencyKey })`.

Failures become `PlatformClientError { status, code, message }`. Only the
JSON fields `error` and `code` are copied. Tokens, hashes, and `gk_` keys
never appear on the error object. `createApiKey` still returns plaintext
`key` on **success**, once.

Pages take a `client` prop. They must not call `fetch` themselves.

## Components

| Export | Role |
| --- | --- |
| `AppShell` | Header, nav (`{label, href}[]`), `userSlot`, main, empty state, `ErrorBoundary`. Optional `tokens` / `designUrl` injects `--pf-*` |
| `AdminLayout` | `AppShell` plus side nav (default `/admin/*` hrefs, including Design) |
| `StatusPage` | Health, version, `/me`. Compares version to `PLATFORM_VERSION`, never a hardcoded string |
| `UsersPage` | Admin+: list + role editor. Owner-only edits of owners |
| `AccessPolicyPage` | Owner: mode, domains, emails |
| `ApiKeysPage` | Own keys; create shows plaintext once; revoke |
| `SettingsPage` | Member read; admin write; `platform.*` owner |
| `AuditPage` | Admin+: `before=id` pagination and action/entity filters |
| `DesignPage` | Owner: Import (paste/upload/Validate/Apply), Gallery (Use), Export (Download `design.md` + copy LLM prompt), Fine-tune, Reset |
| `MutationsPage` | Member+: list of mutations the caller can run, schema form, Run, result or field errors |

Every page has loading / empty / error / 403 states. Optional `preview` is
for tests (`renderToString`); hosts omit it.

## Tokens

`src/ui/tokens.css` defines `--pf-bg`, `--pf-fg`, `--pf-muted`, `--pf-accent`,
`--pf-accent-fg`, `--pf-border`, `--pf-surface`, `--pf-danger`, `--pf-ok`,
`--pf-radius`, `--pf-radius-sm`, `--pf-radius-lg`, `--pf-font`,
`--pf-heading-font`, `--pf-font-size`, `--pf-density`. Components use those
variables plus Tailwind utility classes. 0.10.0: the host generates
`app/design-tokens.css` from root `design.md` (see `docs/DESIGN.md`) and
passes `designUrl="/api/platform/design"` so owner GUI changes apply without
rebuild. Do not invent a second token set in the host. Voice stays in
`design.md` and never reaches CSS.

## How the host mounts

1. Catch-all `app/routes/api/platform/$.ts` forwards **GET, POST, PUT, DELETE,
   OPTIONS, HEAD** (see UPGRADING 0.7.0 correction).
2. In `app/styles.css`:

   ```css
   @import "tailwindcss";
   @import "./design-tokens.css"; /* generated from design.md; fallback: platform tokens.css */
   @source "../platform/src/ui";
   ```

   Tailwind v4 only emits classes it sees. Without `@source`, platform pages
   look unstyled.

3. Create one client module. Pass it into pages. Login UI stays
   application-owned (`UserButton` in `userSlot`).

4. Add route files that only mount:

   ```
   app/routes/index.tsx                 AppShell + StatusPage
   app/routes/admin/index.tsx           AdminLayout + StatusPage
   app/routes/admin/users.tsx           UsersPage
   app/routes/admin/access-policy.tsx   AccessPolicyPage
   app/routes/admin/api-keys.tsx        ApiKeysPage
   app/routes/admin/settings.tsx        SettingsPage
   app/routes/admin/design.tsx          DesignPage
   app/routes/admin/audit.tsx           AuditPage
   ```

   Override `nav` hrefs if the host uses different paths. `onNavigate` is
   optional (tests / client-side transitions).

5. Do not hardcode a platform version string in the host. `StatusPage` reads
   `PLATFORM_VERSION`.
