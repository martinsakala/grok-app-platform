import { afterEach, describe, expect, it } from "vitest";
import {
  createLogger,
  logError,
  setLogSink,
  type LogEntry,
} from "../src/logging/index.js";

afterEach(() => {
  setLogSink(null);
});

describe("createLogger", () => {
  it("injects a sink and writes one JSON-shaped entry", () => {
    const seen: LogEntry[] = [];
    setLogSink((entry) => {
      seen.push(entry);
    });
    const logger = createLogger("test");
    logger.info("hello", { count: 1 });
    expect(seen).toHaveLength(1);
    expect(seen[0].level).toBe("info");
    expect(seen[0].name).toBe("test");
    expect(seen[0].msg).toBe("hello");
    expect(seen[0].count).toBe(1);
    expect(seen[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("redaction", () => {
  it("replaces secret-like keys with [redacted]", () => {
    const seen: LogEntry[] = [];
    setLogSink((entry) => seen.push(entry));
    createLogger("sec").info("keys", {
      accessToken: "abc",
      password: "hunter2",
      session_secret: "s",
      cookie: "sid=1",
      authorization: "Bearer abc",
      safe: "ok",
    });
    expect(seen[0].accessToken).toBe("[redacted]");
    expect(seen[0].password).toBe("[redacted]");
    expect(seen[0].session_secret).toBe("[redacted]");
    expect(seen[0].cookie).toBe("[redacted]");
    expect(seen[0].authorization).toBe("[redacted]");
    expect(seen[0].safe).toBe("ok");
  });

  it("scrubs postgres connection strings and Bearer tokens from strings", () => {
    const seen: LogEntry[] = [];
    setLogSink((entry) => seen.push(entry));
    createLogger("db").error("connect failed", {
      detail:
        "ECONNREFUSED postgres://secret-user:secret-pass@hidden-host:5432/hidden-db Bearer super-secret-token",
    });
    const line = JSON.stringify(seen[0]);
    expect(line).not.toMatch(/secret-user|secret-pass|hidden-host|hidden-db|super-secret-token/);
    expect(seen[0].detail).toContain("[redacted]");
    expect(seen[0].detail).toContain("Bearer [redacted]");
  });
});

describe("logError", () => {
  it("writes name, code, scrubbed message and never a stack", () => {
    const seen: LogEntry[] = [];
    setLogSink((entry) => seen.push(entry));
    const err = Object.assign(
      new Error("boom postgres://u:p@h:5432/db at /workspace/src/secret.ts:9"),
      { code: "ECONNREFUSED" },
    );
    err.stack = "Error: boom\n    at /workspace/src/secret.ts:9:1";
    logError(createLogger("http"), err, "request failed");
    expect(seen[0].msg).toBe("request failed");
    expect(seen[0].name).toBe("http");
    const payload = seen[0].err as { name: string; code: string; message: string };
    expect(payload.name).toBe("Error");
    expect(payload.code).toBe("ECONNREFUSED");
    expect(payload.message).not.toMatch(/postgres:\/\/|u:p@h/);
    expect(seen[0].stack).toBeUndefined();
    expect(payload).not.toHaveProperty("stack");
    expect(JSON.stringify(seen[0])).not.toMatch(/\/workspace\/src\/secret\.ts/);
  });
});
