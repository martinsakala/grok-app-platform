import type { AuthUser } from "../auth/types.js";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MAX_OFFSET = 10_000;

export type DataApiOrderDirection = "asc" | "desc";

/**
 * Host-declared read-only resource. Schema is always `api`.
 * `ownerColumn` is required — 0.5.0 has no anonymous or unscoped resources.
 */
export type DataApiResource = {
  name: string;
  relation: string;
  columns: readonly string[];
  ownerColumn: string;
  orderBy: string;
  orderDirection?: DataApiOrderDirection;
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
};

export type DataApiRegistry = {
  resources: readonly DefinedDataApiResource[];
  resourceByName: ReadonlyMap<string, DefinedDataApiResource>;
};

export type ListResourceInput = {
  resource: unknown;
  user: AuthUser | null | undefined;
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
