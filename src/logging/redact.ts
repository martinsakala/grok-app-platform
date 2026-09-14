import { SECRET_KEY_PATTERN } from "../auth/identity.js";

const CONNECTION_STRING = /\bpostgres(?:ql)?:\/\/\S+/gi;
const BEARER_TOKEN = /\bBearer\s+\S+/gi;
const SOURCE_PATH = /(?:\/[\w.-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs)(?::\d+){0,2}/g;

export function scrubString(value: string): string {
  return value
    .replace(CONNECTION_STRING, "[redacted]")
    .replace(BEARER_TOKEN, "Bearer [redacted]")
    .replace(SOURCE_PATH, "[redacted]");
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactValue(entry);
    }
    return out;
  }
  return String(value);
}

export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  return redactValue(fields) as Record<string, unknown>;
}
