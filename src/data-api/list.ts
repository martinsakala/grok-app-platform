import { UnauthorizedError } from "../auth/errors.js";
import { asAuthUser } from "../auth/principal.js";
import type { Database, SqlParameter } from "../database/types.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { DataApiError, isDataApiError } from "./errors.js";
import { qualifyApiRelation, quoteIdent } from "./identifiers.js";
import { getResource } from "./registry.js";
import type {
  DataApiRegistry,
  DefinedDataApiResource,
  ListResourceInput,
  ListResourceResult,
} from "./types.js";
import { DEFAULT_PAGE_SIZE, MAX_OFFSET, MAX_PAGE_SIZE } from "./types.js";

function requireSessionUser(user: ListResourceInput["user"]) {
  if (!user) throw new UnauthorizedError();
  const authUser = asAuthUser(user);
  if (typeof authUser.id !== "string" || authUser.id.trim() === "") {
    throw new UnauthorizedError();
  }
  return authUser;
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

function orderBySql(orderBy: string, uniqueBy: string, directionSql: string): string {
  const primary = `${quoteIdent(orderBy)} ${directionSql}`;
  if (uniqueBy === orderBy) return primary;
  return `${primary}, ${quoteIdent(uniqueBy)} ${directionSql}`;
}

function selectIdents(resource: DefinedDataApiResource): string[] {
  const columns = [...resource.columns];
  if (!columns.includes(resource.orderBy)) columns.push(resource.orderBy);
  if (!columns.includes(resource.uniqueBy)) columns.push(resource.uniqueBy);
  return columns;
}

function asSqlParam(value: string | number | boolean): SqlParameter {
  return value;
}

/**
 * Read-only list. Always filters by the verified session user on `ownerColumn`.
 * Client `user_id` / schema / SQL fields on the input are ignored.
 *
 * ORDER BY uses `orderBy` then `uniqueBy` (unless they are the same column).
 * `uniqueBy` is selected internally for keyset cursors even when it is not
 * in `columns`; it is stripped from `items` unless the host listed it.
 *
 * `cursor` is a signed keyset token over `(orderBy, uniqueBy)`. When present,
 * `offset` is ignored and the response `offset` is 0. Offset pagination
 * remains for compatibility; it is not a consistent snapshot.
 */
export async function listResource(
  registry: DataApiRegistry,
  db: Database,
  input: ListResourceInput,
): Promise<ListResourceResult> {
  const user = requireSessionUser(input.user);
  const resource = getResource(registry, input.resource);
  const limit = parsePositiveInt(input.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, 1);
  const bound = decodeCursor(input.cursor, resource.name);
  const offset = bound ? 0 : parsePositiveInt(input.offset, 0, MAX_OFFSET, 0);

  const selectList = selectIdents(resource).map((column) => quoteIdent(column)).join(", ");
  const from = qualifyApiRelation(resource.relation);
  const owner = quoteIdent(resource.ownerColumn);
  const direction = resource.orderDirection === "desc" ? "DESC" : "ASC";
  const orderSql = orderBySql(resource.orderBy, resource.uniqueBy, direction);
  const cmp = resource.orderDirection === "desc" ? "<" : ">";

  const params: SqlParameter[] = [user.id];
  let where = `${owner} = $1`;
  if (bound) {
    if (resource.uniqueBy === resource.orderBy) {
      where += ` and ${quoteIdent(resource.orderBy)} ${cmp} $2`;
      params.push(asSqlParam(bound.o));
    } else {
      where += ` and (${quoteIdent(resource.orderBy)}, ${quoteIdent(resource.uniqueBy)}) ${cmp} ($2, $3)`;
      params.push(asSqlParam(bound.o), asSqlParam(bound.u));
    }
  }

  const limitPlaceholder = `$${params.length + 1}`;
  params.push(limit);
  let sql =
    `select ${selectList} from ${from} where ${where} ` +
    `order by ${orderSql} limit ${limitPlaceholder}`;
  if (!bound) {
    const offsetPlaceholder = `$${params.length + 1}`;
    params.push(offset);
    sql += ` offset ${offsetPlaceholder}`;
  }

  try {
    const result = await db.query<Record<string, unknown>>(sql, params);
    const items = result.rows.map((row) => pickColumns(row, resource.columns));
    let nextCursor: string | null = null;
    if (items.length === limit) {
      const last = result.rows[result.rows.length - 1];
      if (last) {
        nextCursor = encodeCursor(resource.name, last[resource.orderBy], last[resource.uniqueBy]);
      }
    }
    return {
      items,
      limit,
      offset,
      nextCursor,
    };
  } catch (error) {
    wrapQueryError(error);
  }
}
