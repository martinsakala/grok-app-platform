import { getInternalDatabase } from "../database/client.js";
import { ForbiddenError } from "../auth/errors.js";
import { parseRoles, type Role } from "../auth/roles.js";
import type { AuthUser } from "../auth/types.js";
import { policyAllows, readPolicy } from "./policy.js";

function listedOwner(user: AuthUser, ownerEmails: readonly string[]): boolean {
  if (ownerEmails.length === 0) return false;
  const email = user.email.trim().toLowerCase();
  return email.length > 0 && ownerEmails.includes(email);
}

/**
 * Assign roles for a newly seen user.
 *
 * When `ownerEmails` is non-empty, only those emails receive `owner` (each of
 * them, even if they are not first). Anyone else gets `member` per policy —
 * they never win the first-user race.
 *
 * When `ownerEmails` is empty, the first authenticated user becomes owner
 * (preview/dev behaviour). Always set `ownerEmails` on a public app.
 */
export async function ensureUserRoles(
  user: AuthUser,
  ownerEmails: readonly string[] = [],
): Promise<Role[]> {
  const db = await getInternalDatabase();
  const listed = listedOwner(user, ownerEmails);
  return db.transaction(async (tx) => {
    await tx.query("select id from private.access_policy where id = 1 for update");
    const existing = await tx.query<{ role: string }>(
      "select role from private.user_roles where user_id = $1",
      [user.id],
    );
    const roles = parseRoles(existing.rows.map((row) => row.role));

    if (listed && !roles.includes("owner")) {
      await tx.query(
        `insert into private.user_roles (user_id, role, granted_by)
         values ($1, 'owner', $1)
         on conflict do nothing`,
        [user.id],
      );
      return parseRoles([...roles, "owner"]);
    }

    if (roles.length > 0) {
      return roles;
    }

    if (ownerEmails.length === 0) {
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