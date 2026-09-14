export type SqlParameter =
  | string
  | number
  | boolean
  | bigint
  | Date
  | null
  | Uint8Array
  | readonly string[];

export type QueryResult<T> = {
  rows: T[];
  rowCount: number;
};

export type DatabaseEngine = "pglite" | "postgresql";

export interface Database {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlParameter[],
  ): Promise<QueryResult<T>>;

  close(): Promise<void>;
}

export type MigrationSource = {
  filename: string;
  sql: string;
};

export type RunMigrationsOptions = {
  applicationMigrations?: readonly MigrationSource[];
  apiMigrations?: readonly MigrationSource[];
};

export type DatabaseDiagnostics = {
  engine: DatabaseEngine;
  connected: boolean;
  migrationsReady: boolean;
};

export type MigrationKind = "platform" | "application" | "api";
