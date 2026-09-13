import { toQueryResult, type InternalDatabase, type Session, type Tx } from "./internal.js";
import type { QueryResult, SqlParameter } from "./types.js";

/**
 * Structural PGlite surface. Hosts inject Grok `getPglite()`; the platform
 * never imports host `src/lib/db.ts`.
 *
 * Native Grok `getSql()` is not enough: it has parameterized `query()` only.
 * No `exec` of multi-statement SQL, no transaction, no held backend session.
 * Production `getSql()` is a `pg.Pool` that borrows a client per query, so it
 * cannot hold `pg_advisory_lock` across per-file COMMIT. See docs/DATABASE.md.
 */
export type PgliteQueryable = {
  query: <T>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: T[]; affectedRows?: number | null }>;
  exec: (sql: string) => Promise<unknown>;
};

export type PgliteLike = PgliteQueryable & {
  transaction: <T>(fn: (tx: PgliteQueryable) => Promise<T>) => Promise<T>;
  waitReady?: Promise<unknown>;
  close?: () => Promise<void>;
};

export type PgliteFactory = () => PgliteLike | Promise<PgliteLike>;

const adapterRef = globalThis as typeof globalThis & {
  __grokPlatformPgliteFactory__?: PgliteFactory;
};

/**
 * Host → platform extension point. Call from server-only boot **before**
 * `getDatabase()` / `runMigrations()`. Pass Grok `() => getPglite()`.
 *
 * Ignored when `DATABASE_URL` is set (production query traffic uses the
 * platform `pg` Pool on that URL). `runMigrations` may open a separate
 * session-capable connection when `DATABASE_URL` is a transaction pooler.

 *
 * `undefined` restores the platform-owned in-process PGlite (tests / no host).
 */
export function setPgliteFactory(factory: PgliteFactory | undefined): void {
  adapterRef.__grokPlatformPgliteFactory__ = factory;
}

export function getPgliteFactory(): PgliteFactory | undefined {
  return adapterRef.__grokPlatformPgliteFactory__;
}

function asParams(params?: readonly SqlParameter[]): SqlParameter[] | undefined {
  if (!params || params.length === 0) return undefined;
  return [...params];
}

function wrapQueryable(client: PgliteQueryable): Tx {
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

/**
 * Wrap an existing PGlite (typically Grok's preview singleton).
 * `adopt: true` — `close()` is a no-op so Better Auth / `getSql()` keep the instance.
 */
export function wrapPglite(
  pg: PgliteLike,
  options: { adopt?: boolean } = {},
): InternalDatabase {
  const root = wrapQueryable(pg);
  const adopt = options.adopt === true;

  function bindSession(): Session {
    return {
      query: root.query,
      exec: root.exec,
      async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
        return pg.transaction(async (inner) => fn(wrapQueryable(inner)));
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
      if (adopt) return;
      if (pg.close) await pg.close();
    },
  };

  return database;
}
