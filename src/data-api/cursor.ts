import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readDatabaseUrl } from "../database/env.js";
import { DataApiError } from "./errors.js";

const CURSOR_VERSION = 1;
const HMAC_BYTES = 32;
const MAX_CURSOR_CHARS = 4096;
const KEY_INFO = "grok-app-platform:data-api:cursor:v1";

type CursorPayload = {
  v: number;
  r: string;
  o: unknown;
  u: unknown;
};

type CursorBound = {
  o: string | number | boolean;
  u: string | number | boolean;
};

let cachedKey: Buffer | undefined;
let cachedFromUrl: string | null | undefined;

/**
 * HMAC key for opaque list cursors. Derived from DATABASE_URL when set so
 * cursors survive process restarts on the same deployment; otherwise a
 * random per-process key (PGlite / missing URL). Never log the URL, the
 * digest, or this key. Cursors are valid only for the same resource on the
 * same deployment — a different DATABASE_URL or process key is
 * `invalid_cursor`, not 500.
 */
function cursorSigningKey(): Buffer {
  const url = readDatabaseUrl();
  if (url) {
    if (cachedKey && cachedFromUrl === url) return cachedKey;
    cachedFromUrl = url;
    cachedKey = createHash("sha256").update(KEY_INFO).update("\0").update(url).digest();
    return cachedKey;
  }
  if (cachedKey && cachedFromUrl === null) return cachedKey;
  cachedFromUrl = null;
  cachedKey = randomBytes(HMAC_BYTES);
  return cachedKey;
}

function invalidCursor(): never {
  throw new DataApiError({
    status: 400,
    code: "invalid_cursor",
    message: "Invalid cursor",
  });
}

function signPayload(payloadB64: string): Buffer {
  return createHmac("sha256", cursorSigningKey()).update(payloadB64).digest();
}

function b64urlToBuffer(value: string): Buffer | null {
  if (!value || /[^A-Za-z0-9_-]/.test(value)) return null;
  try {
    const buf = Buffer.from(value, "base64url");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

export function serializeCursorValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) {
    const iso = value.toISOString();
    return Number.isNaN(value.getTime()) ? null : iso;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof (value as { toISOString?: unknown }).toISOString === "function") {
    try {
      return (value as Date).toISOString();
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return String(value);
  return null;
}

function isCursorScalar(value: unknown): value is string | number | boolean | null {
  if (value === null) return true;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return true;
  return false;
}

export function encodeCursor(resource: string, orderValue: unknown, uniqueValue: unknown): string | null {
  const o = serializeCursorValue(orderValue);
  const u = serializeCursorValue(uniqueValue);
  if (o === null || u === null) return null;
  const json = JSON.stringify({ v: CURSOR_VERSION, r: resource, o, u });
  const payloadB64 = Buffer.from(json, "utf8").toString("base64url");
  const sigB64 = signPayload(payloadB64).toString("base64url");
  return `${payloadB64}.${sigB64}`;
}

/**
 * Returns null when `cursor` is absent. Throws `invalid_cursor` (400) for
 * any malformed, unsigned, foreign-resource, or wrong-version token.
 * Never throws 500.
 */
export function decodeCursor(cursor: unknown, resourceName: string): CursorBound | null {
  if (cursor === undefined || cursor === null || cursor === "") return null;
  if (typeof cursor !== "string" || cursor.length > MAX_CURSOR_CHARS) invalidCursor();
  const dot = cursor.indexOf(".");
  if (dot <= 0 || cursor.indexOf(".", dot + 1) !== -1) invalidCursor();
  const payloadB64 = cursor.slice(0, dot);
  const sigB64 = cursor.slice(dot + 1);
  const payloadBuf = b64urlToBuffer(payloadB64);
  const sigBuf = b64urlToBuffer(sigB64);
  if (!payloadBuf || !sigBuf || sigBuf.length !== HMAC_BYTES) invalidCursor();
  const expected = signPayload(payloadB64);
  if (expected.length !== sigBuf.length || !timingSafeEqual(expected, sigBuf)) invalidCursor();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    invalidCursor();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalidCursor();
  const body = parsed as CursorPayload;
  if (body.v !== CURSOR_VERSION || typeof body.r !== "string") invalidCursor();
  if (body.r !== resourceName) invalidCursor();
  if (!isCursorScalar(body.o) || !isCursorScalar(body.u)) invalidCursor();
  if (body.o === null || body.u === null) invalidCursor();
  return { o: body.o, u: body.u };
}
