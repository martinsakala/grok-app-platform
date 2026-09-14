import { createHash } from "node:crypto";
import { getInternalDatabase } from "../database/client.js";
import type { ApiKeyPrincipal } from "../auth/principal.js";
import { parseRoles } from "../auth/roles.js";

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Resolve a `gk_` bearer to a principal. Never logs the key or hash.
 * `last_used_at` is updated without blocking the request.
 */
export async function lookupApiKey(plaintext: string): Promise<ApiKeyPrincipal | null> {
  if (!plaintext.startsWith("gk_")) return null;
  const hash = hashApiKey(plaintext);
  const db = await getInternalDatabase();
  const result = await db.query<{
    id: string;
    name: string;
    owner_user_id: string;
    roles: string[] | null;
    revoked_at: Date | string | null;
  }>(
    `select id, name, owner_user_id, roles, revoked_at
     from private.api_keys
     where hash = $1
     limit 1`,
    [hash],
  );
  const row = result.rows[0];
  if (!row || row.revoked_at) return null;
  const roles = parseRoles(row.roles ?? []);
  if (roles.length === 0) return null;
  void db
    .query("update private.api_keys set last_used_at = now() where id = $1 and revoked_at is null", [
      row.id,
    ])
    .catch(() => undefined);
  return {
    kind: "api-key",
    keyId: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    roles,
  };
}
