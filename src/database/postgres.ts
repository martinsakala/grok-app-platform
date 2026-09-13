import pg from "pg";
import type { QueryResult, SqlParameter } from "./types.js";
import { toQueryResult, type InternalDatabase, type Tx } from "./internal.js";

const { Pool } = pg;

/**
 * node-postgres (`pg`) — already present in Grok Build hosts, small API,
 * parameterized queries, TLS via the connection string (`sslmode=`), and a
 * tiny pool that is serverless-friendly (warm instances reuse it).
 */
export function createPostgresDatabase(connectionString: string): InternalDatabase {
  const pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: true,
  });

  function bind(client: pg.Pool | pg.PoolClient): Tx {
    return {
      async query<T = Record<string, unknown>>(
        sql: string,
        params?: readonly SqlParameter[],
      ): Promise<QueryResult<T>> {
        const result = await client.query(sql, params ? [...params] : []);
        return toQueryResult(result.rows as T[], result.rowCount);
      },
      async exec(sql: string): Promise<void> {
        await client.query(sql);
      },
    };
  }

  const root = bind(pool);

  return {
    engine: "postgresql",
    query: root.query,
    exec: root.exec,
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          const value = await fn(bind(client));
          await client.query("COMMIT");
          return value;
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // keep original error
          }
          throw error;
        }
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
