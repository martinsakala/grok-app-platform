import { PGlite } from "@electric-sql/pglite";
import type { QueryResult, SqlParameter } from "./types.js";
import { toQueryResult, type InternalDatabase, type Session, type Tx } from "./internal.js";

function asParams(params?: readonly SqlParameter[]): SqlParameter[] | undefined {
  if (!params || params.length === 0) return undefined;
  return [...params];
}

function wrap(client: {
  query: <T>(sql: string, params?: SqlParameter[]) => Promise<{ rows: T[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
}): Tx {
  return {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: readonly SqlParameter[],
    ): Promise<QueryResult<T>> {
      const result = await client.query<T>(sql, asParams(params) as never);
      return toQueryResult(result.rows, result.affectedRows);
    },
    async exec(sql: string): Promise<void> {
      await client.exec(sql);
    },
  };
}

export async function createPgliteDatabase(): Promise<InternalDatabase> {
  const pg = new PGlite();
  await pg.waitReady;
  const root = wrap(pg);

  function bindSession(): Session {
    return {
      query: root.query,
      exec: root.exec,
      async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
        return pg.transaction(async (inner) => fn(wrap(inner)));
      },
    };
  }

  const database: InternalDatabase = {
    engine: "pglite",
    query: root.query,
    exec: root.exec,
    async withSession<T>(fn: (session: Session) => Promise<T>): Promise<T> {
      return fn(bindSession());
    },
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return database.withSession((session) => session.transaction(fn));
    },
    async close(): Promise<void> {
      await pg.close();
    },
  };

  return database;
}
