# Settings (0.8.0)

Named JSON documents in `private.settings`. Not a generic key-value store for
secrets: values are visible to every `member`. Put tokens in API keys, not here.

## Keys

- Regex: `^[a-z][a-z0-9_.-]{0,99}$`
- Prefix `platform.` (and the key `platform`) is reserved: **write = owner
  only**. Other keys: **write = admin+**. **Read = member+**.
- Value: any JSON. Serialized size ≤ 64 KiB; larger → `400`.
- HTTP JSON bodies are still capped at 32 KiB by the router.

## Library

```ts
import { getSetting, setSetting, deleteSetting, listSettings } from "../platform/src/settings/index.js";

await getSetting("app.theme", { color: "light" }); // no ACL; missing → fallback
await listSettings(principal);                     // member+
await setSetting(principal, "app.theme", { color: "dark" });
await deleteSetting(principal, "app.theme");
```

`getSetting` is for server-side defaults. HTTP always goes through a principal.

## HTTP

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/api/platform/settings` | member+ |
| `GET` | `/api/platform/settings/:key` | member+ (404 if missing) |
| `PUT` | `/api/platform/settings/:key` | admin+, or owner for `platform.*`. Body `{ "value": … }` |
| `DELETE` | `/api/platform/settings/:key` | same write rules |

Unknown key on GET → `404`. Invalid key / missing `value` / oversize → `400`.
Unsigned → `401`. Wrong role → `403`.

Writes are audit-logged (`settings.set` / `settings.delete`). Meta is redacted
the same way as the logger (secret-like keys, connection strings, Bearer
tokens). Do not store API keys or passwords in settings values.
`platform.design` is the design overlay (0.11 document `{ markdown, spec }` or
0.10 form subset); prefer `/api/platform/design` (import / PUT / DELETE, audit
`design.import` / `design.set`) over writing that key through this API. See
`docs/DESIGN.md`.

`platform.export.max-rows` (0.14.0, owner write) is a positive integer that
may **only lower** the handler `exportMaxRows` cap (default 100000). Setting
keys are lowercase (`^[a-z][a-z0-9_.-]{0,99}$`), so this is `max-rows`, not
`maxRows`. A larger value is ignored. Invalid values are ignored and the
handler cap stands. See `docs/DATA_API.md`.
