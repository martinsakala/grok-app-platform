import { redactFields, scrubString } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  ts: string;
  level: LogLevel;
  name: string;
  msg: string;
  [key: string]: unknown;
};

export type LogSink = (entry: LogEntry) => void;

export type Logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
};

function defaultSink(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === "warn" || entry.level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

let sink: LogSink = defaultSink;

export function setLogSink(fn: LogSink | null): void {
  sink = fn ?? defaultSink;
}

export function createLogger(name: string): Logger {
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    const extra =
      fields && typeof fields === "object" && !Array.isArray(fields) ? redactFields(fields) : {};
    const entry: LogEntry = {
      ...extra,
      ts: new Date().toISOString(),
      level,
      name,
      msg: scrubString(String(msg)),
    };
    sink(entry);
  };
  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const fields: Record<string, unknown> = {
      name: err.name,
      message: err.message,
    };
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") fields.code = code;
    return fields;
  }
  return { name: "Error", message: String(err) };
}

/**
 * Log a caught error. Message is scrubbed. Never includes a stack (paths)
 * and never emits connection strings, Bearer tokens, or secret-like keys.
 */
export function logError(logger: Logger, err: unknown, msg = "failed"): void {
  logger.error(msg, { err: errorFields(err) });
}
