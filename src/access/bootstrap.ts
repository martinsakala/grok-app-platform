import { getInternalDatabase } from "../database/client.js";
import { ForbiddenError } from "../auth/errors.js";
import { parseRoles, type Role } from "../auth/roles.js";
import type { AuthUser } from "../auth/types.js";
import { policyAllows, readPolicy } from "./policy.js";

/**
 * First authenticated user becomes owner (serialized on access_policy).
 * Later users become member if the allowlist lets them through.
 * Owner always passes. Default policy mode is open.
 */
export async function ensureUserRoles(user: AuthUser): Promise<Role[]> {
  const db = await getInternalDatabase();
  return db.transaction(async (tx) => {
    await tx.query("select id from private.access_policy where id = 1 for update");
    const existing = await tx.query<{ role: string }>(
      "select role from private.user_roles where user_id = $1",
      [user.id],
    );
    if (existing.rows.length > 0) {
      return parseRoles(existing.rows.map((row) => row.role));
    }

    const owners = await tx.query<{ user_id: string }>(
      "select user_id from private.user_roles where role = 'owner' limit 1",
    );
    if (owners.rows.length === 0) {
      await tx.query(
        `insert into private.user_roles (user_id, role, granted_by)
         values ($1, 'owner', $1)`,
        [user.id],
      );
      return ["owner"];
    }

    const policy = await readPolicy(tx);
    if (!policyAllows(user, policy, false)) {
      throw new ForbiddenError("not_allowed");
    }
    await tx.query(
      `insert into private.user_roles (user_id, role, granted_by)
       values ($1, 'member', $1)
       on conflict do nothing`,
      [user.id],
    );
    return ["member"];
  });
}
