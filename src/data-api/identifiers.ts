import { isExcludedFromDataApi } from "../auth/exclusion.js";
import { DataApiError } from "./errors.js";

const SQL_IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const RESOURCE_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const FORBIDDEN_SCHEMA_PREFIXES = new Set([
  "public",
  "private",
  "app",
  "pg_catalog",
  "information_schema",
]);

export function assertResourceName(value: unknown): string {
  if (typeof value !== "string" || !RESOURCE_NAME.test(value)) {
    throw new DataApiError({
      status: 400,
      code: "invalid_input",
      message: "Invalid resource name",
    });
  }
  return value;
}

export function assertSqlIdent(value: unknown, _label: string): string {
  if (typeof value !== "string" || value.includes(".") || !SQL_IDENT.test(value)) {
    throw new DataApiError({
      status: 400,
      code: "invalid_identifier",
      message: "Invalid identifier",
    });
  }
  return value;
}

export function quoteIdent(ident: string): string {
  const safe = assertSqlIdent(ident, "identifier");
  return `"${safe.replaceAll('"', '""')}"`;
}

export function qualifyApiRelation(relation: string): string {
  return `"api".${quoteIdent(assertSqlIdent(relation, "relation"))}`;
}

/**
 * Defense-in-depth: schema-qualified names and Better Auth public tables
 * are never a data-API target. Primary boundary is still "api + allowlist".
 */
export function rejectForbiddenTarget(value: string): void {
  const normalized = value.trim().toLowerCase().replace(/"/g, "");
  const schema = normalized.split(".")[0] ?? "";
  if (normalized.includes(".") && FORBIDDEN_SCHEMA_PREFIXES.has(schema)) {
    throw new DataApiError({
      status: 403,
      code: "forbidden",
      message: "Resource is not available",
    });
  }
  if (isExcludedFromDataApi(value) || isExcludedFromDataApi(`public.${normalized}`)) {
    throw new DataApiError({
      status: 403,
      code: "forbidden",
      message: "Resource is not available",
    });
  }
}
