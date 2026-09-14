import { getInternalDatabase } from "../database/client.js";
import type { Tx } from "../database/internal.js";
import type { AuthUser } from "../auth/types.js";
import { BadRequestError, ForbiddenError } from "../auth/errors.js";
import { requireRole, type Principal } from "../auth/principal.js";

export type AccessMode = "open" | "allowlist";

export type AccessPolicy = {
  mode: AccessMode;
  allowedDomains: string[];
  allowedEmails: string[];
  updatedAt: string | null;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().toLowerCase();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return "";
  return email.slice(at + 1).toLowerCase();
}

export function policyAllows(user: AuthUser, policy: AccessPolicy, isOwner: boolean): boolean {
  if (isOwner) return true;
  if (policy.mode === "open") return true;
  const email = user.email.trim().toLowerCase();
  if (email && policy.allowedEmails.includes(email)) return true;
  const domain = emailDomain(email);
  return Boolean(domain && policy.allowedDomains.includes(domain));
}

function rowToPolicy(row: {
  mode: string;
  allowed_domains: string[] | null;
  allowed_emails: string[] | null;
  updated_at: Date | string | null;
}): AccessPolicy {
  const updated =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at
        ? String(row.updated_at)
        : null;
  return {
    mode: row.mode === "allowlist" ? "allowlist" : "open",
    allowedDomains: row.allowed_domains ?? [],
    allowedEmails: row.allowed_emails ?? [],
    updatedAt: updated,
  };
}

export async function readPolicy(tx: Pick<Tx, "query">): Promise<AccessPolicy> {
  const result = await tx.query<{
    mode: string;
    allowed_domains: string[];
    allowed_emails: string[];
    updated_at: Date | string | null;
  }>(
    `select mode, allowed_domains, allowed_emails, updated_at
     from private.access_policy where id = 1`,
  );
  const row = result.rows[0];
  if (!row) {
    return { mode: "open", allowedDomains: [], allowedEmails: [], updatedAt: null };
  }
  return rowToPolicy(row);
}

export async function getAccessPolicy(principal: Principal): Promise<AccessPolicy> {
  requireRole(principal, "owner");
  const db = await getInternalDatabase();
  return readPolicy(db);
}

export async function setAccessPolicy(
  principal: Principal,
  input: { mode?: unknown; allowed_domains?: unknown; allowed_emails?: unknown },
): Promise<AccessPolicy> {
  requireRole(principal, "owner");
  const mode = input.mode === "allowlist" ? "allowlist" : input.mode === "open" ? "open" : null;
  if (!mode) throw new BadRequestError("Invalid access policy");
  const allowedDomains = asStringArray(input.allowed_domains);
  const allowedEmails = asStringArray(input.allowed_emails);
  const db = await getInternalDatabase();
  const result = await db.query<{
    mode: string;
    allowed_domains: string[];
    allowed_emails: string[];
    updated_at: Date | string | null;
  }>(
    `update private.access_policy
     set mode = $1,
         allowed_domains = $2,
         allowed_emails = $3,
         updated_at = now()
     where id = 1
     returning mode, allowed_domains, allowed_emails, updated_at`,
    [mode, allowedDomains, allowedEmails],
  );
  const row = result.rows[0];
  if (!row) throw new ForbiddenError("forbidden");
  return rowToPolicy(row);
}
