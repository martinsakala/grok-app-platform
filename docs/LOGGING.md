# Logging (0.6.0)

Server-only structured logger. One JSON object per line. Never a place for
secrets, connection strings, or filesystem stacks.

## API

```ts
import { createLogger, logError, setLogSink } from "../platform/src/logging/index.js";

const log = createLogger("orders");
log.info("listed", { count: 12 });
try {
  await work();
} catch (error) {
  logError(log, error, "work failed");
}
```

| Call | Line |
| --- | --- |
| `debug` / `info` | stdout (`console.log`) |
| `warn` / `error` | stderr (`console.error`) |

Shape: `{ ts, level, name, msg, ...fields }`. `ts` is ISO-8601 UTC.

`setLogSink(fn)` replaces the output (tests). `setLogSink(null)` restores the
default. There is one process-wide sink.

## Redaction

- Object **keys** matching `SECRET_KEY_PATTERN` from `src/auth/identity.ts`
  (`token`, `secret`, `password`, `hash`, `credential`, `authorization`,
  `cookie`, `bearer`, case-insensitive) become `"[redacted]"`.
- String **values** have `postgres://…`, `postgresql://…`, and `Bearer <token>`
  replaced with `"[redacted]"` / `"Bearer [redacted]"`. Nested objects and
  arrays are walked.

`logError(logger, err)` writes `err: { name, code, message }` (message scrubbed)
so it does not overwrite the logger `name`. It never includes `stack` (paths)
and never logs a database URL, host, or user.

## What not to do

- Do not `console.error` platform failures. Use `logError`.
- Do not put `DATABASE_URL`, tokens, or password hashes in `fields`.
- Do not log the current user as an authorization decision — identity still
  comes only from `requireUser`.
