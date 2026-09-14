import { UnauthorizedError } from "../auth/errors.js";
import type { Database } from "../database/types.js";
import { DataApiError, isDataApiError } from "./errors.js";
import { qualifyApiRelation, quoteIdent } from "./identifiers.js";
import { getResource } from "./registry.js";
import type { DataApiRegistry, ListResourceInput, ListResourceResult } from "./types.js";
import { DEFAULT_PAGE_SIZE, MAX_OFFSET, MAX_PAGE_SIZE } from "./types.js";

function requireSessionUser(user: ListResourceInput["user"]) {
  if (!user || typeof user.id !== "string" || user.id.trim() === "") {
    throw new UnauthorizedError();
  }
  return user;
}

function parsePositiveInt(value: unknown, fallback: number, max: number, min: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  let raw: number;
  if (typeof value === "number") {
    raw = value;
  } else if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    raw = Number.parseInt(value, 10);
  } else {
    throw new DataApiError({
      status: 400,
      code: "invalid_input",
      message: "Invalid page parameters",
    });
  }
  if (!Number.isInteger(raw) || raw < min || raw > max) {
    throw new DataApiError({
      status: 400,
      code: "invalid_input",
      message: "Invalid page parameters",
    });
  }
  return raw;
}

function pickColumns(
  row: Record<string, unknown>,
  columns: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of columns) {
    out[column] = Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null;
  }
  return out;
}

function wrapQueryError(error: unknown): never {
  if (isDataApiError(error) || error instanceof UnauthorizedError) throw error;
  throw new DataApiError({
    status: 500,
    code: "query_failed",
    message: "Resource query failed",
  });
}

/**
 * Read-only list. Always filters by the verified session user on `ownerColumn`.
 * Client `user_id` / schema / SQL fields on the input are ignored.
 */
export async function listResource(
  registry: DataApiRegistry,
  db: Database,
  input: ListResourceInput,
): Promise<ListResourceResult> {
  const user = requireSessionUser(input.user);
  const resource = getResource(registry, input.resource);
  const limit = parsePositiveInt(input.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, 1);
  const offset = parsePositiveInt(input.offset, 0, MAX_OFFSET, 0);

  const selectList = resource.columns.map((column) => quoteIdent(column)).join(", ");
  const from = qualifyApiRelation(resource.relation);
  const owner = quoteIdent(resource.ownerColumn);
  const orderBy = quoteIdent(resource.orderBy);
  const direction = resource.orderDirection === "desc" ? "DESC" : "ASC";
  const tiebreaker =
    resource.columns.includes("id") && resource.orderBy !== "id"
      ? `, ${quoteIdent("id")} ${direction}`
      : "";

  const sql =
    `select ${selectList} from ${from} where ${owner} = $1 ` +
    `order by ${orderBy} ${direction}${tiebreaker} limit $2 offset $3`;

  try {
    const result = await db.query<Record<string, unknown>>(sql, [user.id, limit, offset]);
    return {
      items: result.rows.map((row) => pickColumns(row, resource.columns)),
      limit,
      offset,
    };
  } catch (error) {
    wrapQueryError(error);
  }
}
