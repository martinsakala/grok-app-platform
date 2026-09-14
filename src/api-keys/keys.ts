import { randomBytes } from "node:crypto";
import { audit } from "../audit/index.js";
import { getInternalDatabase } from "../database/client.js";
import { BadRequestError, ForbiddenError } from "../auth/errors.js";
import { hasRole, ownerIdOf, type Principal } from "../auth/principal.js";
import { parseRoles, rolesWithinGrant, type Role } from "../auth/roles.js";
import { hashApiKey } from "./lookup.js";

export type ApiKeyView = {
  id: string;
  name: string;
  prefix: string;
  ownerUserId: string;
  roles: Role[];
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedApiKey = ApiKeyView & { key: string };

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
}

function generatePlaintext(): { key: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  const key = `gk_${secret}`;
  return { key, prefix: secret.slice(0, 8), hash: hashApiKey(key) };
}

function rowToView(row: {
  id: string;
  name: string;
  prefix: string;
  owner_user_id: string;
  roles: string[] | null;
  created_at: Date | string | null;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    ownerUserId: row.owner_user_id,
    roles: parseRoles(row.roles ?? []),
    createdAt: asIso(row.created_at),
    lastUsedAt: asIso(row.last_used_at),
    revokedAt: asIso(row.revoked_at),
  };
}

export async function createApiKey(
  principal: Principal,
  input: { name?: unknown; roles?: unknown },
): Promise<CreatedApiKey> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new BadRequestError("Invalid API key name");
  const roles = parseRoles(input.roles);
  if (roles.length === 0) throw new BadRequestError("Invalid API key roles");
  if (!rolesWithinGrant(roles, principal.roles)) {
    throw new ForbiddenError("forbidden");
  }
  const { key, prefix, hash } = generatePlaintext();
  const id = randomBytes(16).toString("hex");
  const ownerUserId = ownerIdOf(principal);
  const db = await getInternalDatabase();
  const result = await db.query<{
    id: string;
    name: string;
    prefix: string;
    owner_user_id: string;
    roles: string[];
    created_at: Date | string | null;
    last_used_at: Date | string | null;
    revoked_at: Date | string | null;
  }>(
    `insert into private.api_keys (id, name, prefix, hash, owner_user_id, roles)
     values ($1, $2, $3, $4, $5, $6)
     returning id, name, prefix, owner_user_id, roles, created_at, last_used_at, revoked_at`,
    [id, name, prefix, hash, ownerUserId, roles],
  );
  const row = result.rows[0];
  if (!row) throw new ForbiddenError("forbidden");
  const view = rowToView(row);
  await audit(principal, {
    action: "api_key.create",
    entity: "api_key",
    entityId: view.id,
    meta: { name: view.name, prefix: view.prefix },
  });
  return { ...view, key };
}

export async function listApiKeys(principal: Principal): Promise<ApiKeyView[]> {
  const db = await getInternalDatabase();
  const admin = hasRole(principal, "admin");
  const result = await db.query<{
    id: string;
    name: string;
    prefix: string;
    owner_user_id: string;
    roles: string[] | null;
    created_at: Date | string | null;
    last_used_at: Date | string | null;
    revoked_at: Date | string | null;
  }>(
    admin
      ? `select id, name, prefix, owner_user_id, roles, created_at, last_used_at, revoked_at
         from private.api_keys
         order by created_at desc`
      : `select id, name, prefix, owner_user_id, roles, created_at, last_used_at, revoked_at
         from private.api_keys
         where owner_user_id = $1
         order by created_at desc`,
    admin ? [] : [ownerIdOf(principal)],
  );
  return result.rows.map(rowToView);
}

export async function revokeApiKey(principal: Principal, keyId: string): Promise<void> {
  if (typeof keyId !== "string" || keyId.trim() === "") throw new ForbiddenError("forbidden");
  const db = await getInternalDatabase();
  const admin = hasRole(principal, "admin");
  const result = await db.query<{ id: string }>(
    admin
      ? `update private.api_keys
         set revoked_at = now()
         where id = $1 and revoked_at is null
         returning id`
      : `update private.api_keys
         set revoked_at = now()
         where id = $1 and owner_user_id = $2 and revoked_at is null
         returning id`,
    admin ? [keyId] : [keyId, ownerIdOf(principal)],
  );
  if (result.rows.length === 0) throw new ForbiddenError("forbidden");
  await audit(principal, {
    action: "api_key.revoke",
    entity: "api_key",
    entityId: keyId,
  });
}
