import { audit } from "../audit/index.js";
import { getInternalDatabase } from "../database/client.js";
import { BadRequestError, ForbiddenError } from "../auth/errors.js";
import { requireRole, type Principal } from "../auth/principal.js";
import { isRole, parseRoles, type Role } from "../auth/roles.js";

export type ListedUser = {
  id: string;
  email: string;
  name: string | null;
  roles: Role[];
  created: string | null;
};

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
}

export async function listUsers(principal: Principal): Promise<ListedUser[]> {
  requireRole(principal, "admin");
  const db = await getInternalDatabase();
  const result = await db.query<{
    id: string;
    email: string;
    name: string | null;
    roles: string[] | null;
    created: Date | string | null;
  }>(
    `select u.id,
            u.email,
            u.name,
            array_agg(r.role order by r.role) as roles,
            u."createdAt" as created
     from public."user" u
     join private.user_roles r on r.user_id = u.id
     group by u.id, u.email, u.name, u."createdAt"
     order by u."createdAt" asc`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    roles: parseRoles(row.roles ?? []),
    created: asIso(row.created),
  }));
}

export async function setRoles(
  principal: Principal,
  targetUserId: string,
  rolesInput: unknown,
): Promise<Role[]> {
  requireRole(principal, "admin");
  if (typeof targetUserId !== "string" || targetUserId.trim() === "") {
    throw new BadRequestError("Invalid user id");
  }
  if (!Array.isArray(rolesInput)) throw new BadRequestError("Invalid roles");
  const next = parseRoles(rolesInput);
  if (next.length === 0 || next.length !== rolesInput.filter((r) => isRole(r)).length) {
    throw new BadRequestError("Invalid roles");
  }

  const actorIsOwner = principal.roles.includes("owner");
  const grantsOwner = next.includes("owner");

  const db = await getInternalDatabase();
  const applied = await db.transaction(async (tx) => {
    await tx.query("select id from private.access_policy where id = 1 for update");
    const current = await tx.query<{ role: string }>(
      "select role from private.user_roles where user_id = $1",
      [targetUserId],
    );
    const currentRoles = parseRoles(current.rows.map((row) => row.role));
    const targetIsOwner = currentRoles.includes("owner");

    if (!actorIsOwner && (targetIsOwner || grantsOwner)) {
      throw new ForbiddenError("forbidden");
    }

    if (targetIsOwner && !grantsOwner) {
      const owners = await tx.query<{ n: number }>(
        "select count(*)::int as n from private.user_roles where role = 'owner'",
      );
      if ((owners.rows[0]?.n ?? 0) <= 1) {
        throw new ForbiddenError("forbidden");
      }
    }

    await tx.query("delete from private.user_roles where user_id = $1", [targetUserId]);
    const grantedBy = principal.kind === "user" ? principal.user.id : principal.ownerUserId;
    for (const role of next) {
      await tx.query(
        `insert into private.user_roles (user_id, role, granted_by)
         values ($1, $2, $3)`,
        [targetUserId, role, grantedBy],
      );
    }
    return next;
  });
  await audit(principal, {
    action: "roles.set",
    entity: "user",
    entityId: targetUserId,
    meta: { roles: applied },
  });
  return applied;
}
