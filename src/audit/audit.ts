import { getInternalDatabase } from "../database/client.js";
import { BadRequestError } from "../auth/errors.js";
import { requireRole, type Principal } from "../auth/principal.js";
import { createLogger, logError, redactValue } from "../logging/index.js";

const logger = createLogger("audit");

export type AuditAction =
  | "owner.bootstrap"
  | "member.auto"
  | "roles.set"
  | "access_policy.set"
  | "api_key.create"
  | "api_key.revoke"
  | "settings.set"
  | "settings.delete"
  | "design.set";

export type AuditInput = {
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: unknown;
};

export type AuditEntry = {
  id: number;
  at: string;
  principalKind: string;
  principalId: string;
  principalLabel: string;
  action: string;
  entity: string;
  entityId: string | null;
  meta: unknown;
};

export type ListAuditQuery = {
  limit?: unknown;
  before?: unknown;
  action?: unknown;
  entity?: unknown;
  entity_id?: unknown;
  principal_id?: unknown;
};

const SENSITIVE_META_KEY = /(token|secret|password|hash|credential|authorization|cookie|bearer|api[_-]?key)/i;

function principalIdOf(principal: Principal): string {
  return principal.kind === "user" ? principal.user.id : principal.keyId;
}

function principalLabelOf(principal: Principal): string {
  if (principal.kind === "user") {
    return principal.user.email || principal.user.name || principal.user.id;
  }
  return principal.name;
}

function extraRedact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(extraRedact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_META_KEY.test(key) ? "[redacted]" : extraRedact(entry);
    }
    return out;
  }
  return value;
}

export function redactAuditMeta(meta: unknown): unknown {
  if (meta === undefined) return {};
  return extraRedact(redactValue(meta));
}

function asIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
}

function asId(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return Number(value);
}

/**
 * Append an audit row. Meta is redacted (no secrets, keys, or hashes).
 * A write failure is logged and never thrown — the originating request continues.
 */
export async function audit(principal: Principal, input: AuditInput): Promise<void> {
  try {
    const db = await getInternalDatabase();
    const meta = JSON.stringify(redactAuditMeta(input.meta ?? {}));
    await db.query(
      `insert into private.audit_log
         (principal_kind, principal_id, principal_label, action, entity, entity_id, meta)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        principal.kind,
        principalIdOf(principal),
        principalLabelOf(principal),
        input.action,
        input.entity,
        input.entityId ?? null,
        meta,
      ],
    );
  } catch (error) {
    logError(logger, error, "audit write failed");
  }
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new BadRequestError(`Invalid ${label}`);
  if (value.length > 200) throw new BadRequestError(`Invalid ${label}`);
  return value;
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return 50;
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestError("Invalid limit");
  if (n > 100) throw new BadRequestError("Invalid limit");
  return n;
}

function parseBefore(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestError("Invalid before");
  return n;
}

export async function listAudit(
  principal: Principal,
  query: ListAuditQuery = {},
): Promise<{ entries: AuditEntry[]; nextBefore: number | null }> {
  requireRole(principal, "admin");
  const limit = parseLimit(query.limit);
  const before = parseBefore(query.before);
  const action = optionalText(query.action, "action");
  const entity = optionalText(query.entity, "entity");
  const entityId = optionalText(query.entity_id, "entity_id");
  const principalId = optionalText(query.principal_id, "principal_id");

  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const add = (sql: string, value: string | number) => {
    params.push(value);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (before !== undefined) add("id < ?", before);
  if (action !== undefined) add("action = ?", action);
  if (entity !== undefined) add("entity = ?", entity);
  if (entityId !== undefined) add("entity_id = ?", entityId);
  if (principalId !== undefined) add("principal_id = ?", principalId);
  params.push(limit);
  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const db = await getInternalDatabase();
  const result = await db.query<{
    id: unknown;
    at: Date | string;
    principal_kind: string;
    principal_id: string;
    principal_label: string;
    action: string;
    entity: string;
    entity_id: string | null;
    meta: unknown;
  }>(
    `select id, at, principal_kind, principal_id, principal_label, action, entity, entity_id, meta
     from private.audit_log
     ${where}
     order by id desc
     limit $${params.length}`,
    params,
  );
  const entries = result.rows.map((row) => {
    let meta: unknown = row.meta ?? {};
    if (typeof meta === "string") {
      try {
        meta = JSON.parse(meta);
      } catch {
        meta = {};
      }
    }
    return {
      id: asId(row.id),
      at: asIso(row.at),
      principalKind: row.principal_kind,
      principalId: row.principal_id,
      principalLabel: row.principal_label,
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id,
      meta,
    };
  });
  const nextBefore =
    entries.length === limit ? (entries[entries.length - 1]?.id ?? null) : null;
  return { entries, nextBefore };
}
