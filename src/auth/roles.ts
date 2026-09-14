export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export function isRole(value: unknown): value is Role {
  return value === "owner" || value === "admin" || value === "member";
}

export function parseRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return [];
  const out: Role[] = [];
  for (const entry of value) {
    if (isRole(entry) && !out.includes(entry)) out.push(entry);
  }
  return out;
}

export function maxRoleRank(roles: readonly Role[]): number {
  let max = 0;
  for (const role of roles) max = Math.max(max, RANK[role]);
  return max;
}

/** owner ⊇ admin ⊇ member */
export function roleCovers(held: readonly Role[], needed: Role): boolean {
  return maxRoleRank(held) >= RANK[needed];
}

export function rolesWithinGrant(requested: readonly Role[], granter: readonly Role[]): boolean {
  const cap = maxRoleRank(granter);
  return requested.length > 0 && requested.every((role) => RANK[role] <= cap);
}
