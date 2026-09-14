import { getInternalDatabase } from "../database/client.js";
import { audit } from "../audit/index.js";
import { BadRequestError } from "../auth/errors.js";
import { requireRole, type Principal } from "../auth/principal.js";

export const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,99}$/;
export const MAX_SETTING_BYTES = 64 * 1024;

export type SettingRecord = {
  key: string;
  value: unknown;
  updatedBy: string | null;
  updatedAt: string | null;
};

function assertSettingKey(key: string): void {
  if (typeof key !== "string" || !SETTING_KEY_PATTERN.test(key)) {
    throw new BadRequestError("Invalid setting key");
  }
}

export function isPlatformSettingKey(key: string): boolean {
  return key === "platform" || key.startsWith("platform.");
}

function assertWriteAccess(principal: Principal, key: string): void {
  if (isPlatformSettingKey(key)) requireRole(principal, "owner");
  else requireRole(principal, "admin");
}

function encodeValue(value: unknown): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new BadRequestError("Invalid setting value");
  }
  if (encoded === undefined) throw new BadRequestError("Invalid setting value");
  if (encoded.length > MAX_SETTING_BYTES) {
    throw new BadRequestError("Setting value too large");
  }
  return encoded;
}

function decodeValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
}

function rowToRecord(row: {
  key: string;
  value: unknown;
  updated_by: string | null;
  updated_at: Date | string | null;
}): SettingRecord {
  return {
    key: row.key,
    value: decodeValue(row.value),
    updatedBy: row.updated_by,
    updatedAt: asIso(row.updated_at),
  };
}

export async function getSetting<T = unknown>(key: string, fallback: T): Promise<T> {
  assertSettingKey(key);
  const db = await getInternalDatabase();
  const result = await db.query<{ value: unknown }>(
    "select value from private.settings where key = $1",
    [key],
  );
  if (result.rows.length === 0) return fallback;
  return decodeValue(result.rows[0]?.value) as T;
}

export async function listSettings(principal: Principal): Promise<SettingRecord[]> {
  requireRole(principal, "member");
  const db = await getInternalDatabase();
  const result = await db.query<{
    key: string;
    value: unknown;
    updated_by: string | null;
    updated_at: Date | string | null;
  }>(
    `select key, value, updated_by, updated_at
     from private.settings
     order by key asc`,
  );
  return result.rows.map(rowToRecord);
}

export async function getSettingRecord(
  principal: Principal,
  key: string,
): Promise<SettingRecord | null> {
  requireRole(principal, "member");
  assertSettingKey(key);
  const db = await getInternalDatabase();
  const result = await db.query<{
    key: string;
    value: unknown;
    updated_by: string | null;
    updated_at: Date | string | null;
  }>(
    `select key, value, updated_by, updated_at
     from private.settings where key = $1`,
    [key],
  );
  const row = result.rows[0];
  return row ? rowToRecord(row) : null;
}

export async function setSetting(
  principal: Principal,
  key: string,
  value: unknown,
): Promise<SettingRecord> {
  assertSettingKey(key);
  assertWriteAccess(principal, key);
  const encoded = encodeValue(value);
  const updatedBy = principal.kind === "user" ? principal.user.id : principal.ownerUserId;
  const db = await getInternalDatabase();
  const result = await db.query<{
    key: string;
    value: unknown;
    updated_by: string | null;
    updated_at: Date | string | null;
  }>(
    `insert into private.settings (key, value, updated_by, updated_at)
     values ($1, $2::jsonb, $3, now())
     on conflict (key) do update
       set value = excluded.value,
           updated_by = excluded.updated_by,
           updated_at = now()
     returning key, value, updated_by, updated_at`,
    [key, encoded, updatedBy],
  );
  const row = result.rows[0];
  if (!row) throw new BadRequestError("Invalid setting");
  const record = rowToRecord(row);
  await audit(principal, {
    action: "settings.set",
    entity: "setting",
    entityId: key,
    meta: { key, value },
  });
  return record;
}

export async function deleteSetting(principal: Principal, key: string): Promise<void> {
  assertSettingKey(key);
  assertWriteAccess(principal, key);
  const db = await getInternalDatabase();
  const result = await db.query<{ key: string }>(
    "delete from private.settings where key = $1 returning key",
    [key],
  );
  if (result.rows.length === 0) throw new BadRequestError("Unknown setting");
  await audit(principal, {
    action: "settings.delete",
    entity: "setting",
    entityId: key,
    meta: { key },
  });
}
