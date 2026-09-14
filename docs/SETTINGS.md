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
