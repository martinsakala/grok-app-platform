import type { Principal } from "../auth/principal.js";
import type { AuthUser } from "../auth/types.js";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MAX_OFFSET = 10_000;

export type DataApiOrderDirection = "asc" | "desc";

/**
 * Host-declared read-only resource. Schema is always `api`.
 * `ownerColumn` is required — 0.5.x has no anonymous or unscoped resources.
 *
 * `uniqueBy` is the column that makes `ORDER BY` unique **within one owner**.
 * It is used in `ORDER BY` even when it is not returned. The application is
 * responsible for that uniqueness on the published view; the name `id` does
 * not prove it. Offset pagination is not a consistent snapshot.
 */
export type DataApiResource = {
  name: string;
  relation: string;
  columns: readonly string[];
  ownerColumn: string;
  orderBy: string;
  orderDirection?: DataApiOrderDirection;
  uniqueBy?: string;
};

export type DataApiConfig = {
  resources: readonly DataApiResource[];
};

export type DefinedDataApiResource = {
  name: string;
  relation: string;
  columns: readonly string[];
  ownerColumn: string;
  orderBy: string;
  orderDirection: DataApiOrderDirection;
  uniqueBy: string;
};

export type DataApiRegistry = {
  resources: readonly DefinedDataApiResource[];
  resourceByName: ReadonlyMap<string, DefinedDataApiResource>;
};

export type ListResourceInput = {
  resource: unknown;
  user: AuthUser | Principal | null | undefined;
  limit?: unknown;
  offset?: unknown;
  /** Ignored. Client identity is never an authorization authority. */
  user_id?: unknown;
  schema?: unknown;
  table?: unknown;
  sql?: unknown;
  columns?: unknown;
};

export type ListResourceResult = {
  items: Record<string, unknown>[];
  limit: number;
  offset: number;
};
