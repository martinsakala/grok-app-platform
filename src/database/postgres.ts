import pg from "pg";
import type { QueryResult, SqlParameter } from "./types.js";
import { toQueryResult, type InternalDatabase, type Session, type Tx } from "./internal.js";

const { Pool } = pg;

export type PostgresDatabaseOptions = {
  /** Pool size. Query traffic uses 4; the migration runner uses 1. */
  max?: number;
};

/**
 * node-postgres (`pg`) — already present in Grok Build hosts, small API,
 * parameterized queries, TLS via the connection string (`sslmode=`), and a
 * tiny pool that is serverless-friendly (warm instances reuse it).
 *
 * `pool.connect()` holds a client of this Pool. That preserves a backend
 * session only when the connection string is a **direct** Postgres endpoint.
 * A transaction pooler (Neon `-pooler` / PgBouncer port 6543) returns the
 * backend after COMMIT, so session-level `pg_advisory_lock` does not survive
 * the inter-file gap. The migration runner therefore uses a session-capable
 * URL (see `resolveMigrationConnectionString`). Query traffic may stay pooled.
 */
export function createPostgresDatabase(
  connectionString: string,
  options: PostgresDatabaseOptions = {},
): InternalDatabase {
  const pool = new Pool({
    connectionString,
    max: options.max ?? 4,
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

  function bindSession(client: pg.PoolClient): Session {
    const tx = bind(client);
    return {
      query: tx.query,
      exec: tx.exec,
      async transaction<T>(fn: (inner: Tx) => Promise<T>): Promise<T> {
        await client.query("BEGIN");
        try {
          const value = await fn(tx);
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
      },
    };
  }

  const root = bind(pool);

  const database: InternalDatabase = {
    engine: "postgresql",
    query: root.query,
    exec: root.exec,
    /**
     * Hold one pool client for the duration of `fn`. Session-level state
     * (advisory locks) is preserved across the per-file transactions that
     * `fn` opens on this client **only if** the pool talks to a real Postgres
     * session, not a transaction pooler. On error the client is destroyed
     * rather than returned to the pool, so a leftover session lock cannot leak.
     */
    async withSession<T>(fn: (session: Session) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      let failed = false;
      try {
        return await fn(bindSession(client));
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        client.release(failed);
      }
    },
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return database.withSession((session) => session.transaction(fn));
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };

  return database;
}
