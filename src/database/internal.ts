import type { Database, DatabaseEngine, QueryResult, SqlParameter } from "./types.js";

export type Tx = {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlParameter[],
  ): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
};

export interface InternalDatabase extends Database {
  readonly engine: DatabaseEngine;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export function toQueryResult<T>(rows: T[], rowCount?: number | null): QueryResult<T> {
  if (rows.length > 0) {
    return { rows, rowCount: rows.length };
  }
  return { rows, rowCount: typeof rowCount === "number" ? rowCount : 0 };
}
