import type { AuthSession, AuthUser } from "./types.js";

const AUTH_USER_KEYS = ["id", "email", "name", "image"] as const;

export const SECRET_KEY_PATTERN =
  /(token|secret|password|hash|credential|authorization|cookie|bearer)/i;


function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function userRecordFromUnknown(raw: unknown): Record<string, unknown> | null {
  const record = asRecord(raw);
  if (!record) return null;
  if (asRecord(record.user)) return asRecord(record.user);
  return record;
}

function sessionRecordFromUnknown(raw: unknown): Record<string, unknown> | null {
  const record = asRecord(raw);
  if (!record) return null;
  if (asRecord(record.session)) return asRecord(record.session);
  return record;
}

/**
 * Map a Better Auth (or compatible) user/session blob to `AuthUser`.
 * Extra fields — including tokens, hashes, and provider metadata — are dropped.
 * Returns null when there is no usable `id`.
 */
export function toAuthUser(raw: unknown): AuthUser | null {
  const user = userRecordFromUnknown(raw);
  if (!user) return null;
  const id = asNonEmptyString(user.id);
  if (!id) return null;
  return {
    id,
    email: asNullableString(user.email) ?? "",
    name: asNullableString(user.name),
    image: asNullableString(user.image),
  };
}

function expiresAtFromUnknown(raw: unknown): string | null {
  const session = sessionRecordFromUnknown(raw);
  const record = asRecord(raw);
  const value = session?.expiresAt ?? record?.expiresAt;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

export function toAuthSession(raw: unknown): AuthSession | null {
  const user = toAuthUser(raw);
  if (!user) return null;
  return {
    user,
    expiresAt: expiresAtFromUnknown(raw),
  };
}

/**
 * Invariant: client-provided `user_id` is never an authorization authority.
 * Ownership always comes from the verified session user.
 */
export function ownerIdFromSession(
  user: AuthUser,
  _clientPayload?: { user_id?: unknown } | null,
): string {
  return user.id;
}

/**
 * Copy a client record but force `user_id` from the verified session.
 * Any client-supplied `user_id` is discarded.
 */
export function assignOwner<T extends Record<string, unknown>>(
  user: AuthUser,
  record: T,
): Omit<T, "user_id"> & { user_id: string } {
  const { user_id: _ignored, ...rest } = record;
  return { ...rest, user_id: user.id };
}

export function assertNoSecrets(payload: unknown, label = "auth payload"): void {
  const seen = new Set<unknown>();
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        throw new Error(`${label} leaked secret-like key ${JSON.stringify(key)} at ${path}`);
      }
      walk(entry, path ? `${path}.${key}` : key);
    }
  };
  walk(payload, "");
}

export function authUserKeys(): readonly string[] {
  return AUTH_USER_KEYS;
}
