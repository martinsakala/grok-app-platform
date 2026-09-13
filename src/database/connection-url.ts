/**
 * Classify a Postgres connection string and resolve a session-capable URL
 * for migration advisory locks.
 *
 * Never log or return the URL, hostname, username, database name, or password.
 * Errors mention only env-var names and generic pooling reasons.
 */

export type PostgresPoolingMode = "direct" | "transaction-pooler" | "unknown";

export type PostgresConnectionClassification = {
  mode: PostgresPoolingMode;
  neon: boolean;
  reasons: readonly string[];
};

const SESSION_URL_ENV_KEYS = [
  "DATABASE_URL_UNPOOLED",
  "DIRECT_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

const POOLER_SUFFIX = "-pooler";

function readTrimmedEnv(key: string): string | undefined {
  const raw = typeof process !== "undefined" ? process.env[key] : undefined;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePostgresUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid connection URL");
  }
}

function isNeonHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "neon.tech" || host.endsWith(".neon.tech");
}

function hasPoolerLabel(hostname: string): boolean {
  return hostname
    .toLowerCase()
    .split(".")
    .some((label) => label.endsWith(POOLER_SUFFIX) && label.length > POOLER_SUFFIX.length);
}

function neonDirectHostname(hostname: string): string | undefined {
  if (!isNeonHost(hostname) || !hasPoolerLabel(hostname)) return undefined;
  return hostname
    .split(".")
    .map((label) =>
      label.toLowerCase().endsWith(POOLER_SUFFIX) && label.length > POOLER_SUFFIX.length
        ? label.slice(0, -POOLER_SUFFIX.length)
        : label,
    )
    .join(".");
}

/**
 * Replace only the hostname, preserving userinfo encoding, port, path, and query.
 * Refuses to rewrite if the hostname cannot be located in the original string.
 */
export function replaceUrlHostname(url: string, newHostname: string): string {
  const parsed = parsePostgresUrl(url);
  const oldHost = parsed.hostname;
  if (!oldHost) {
    throw new Error("DATABASE_URL is not a valid connection URL");
  }
  const at = url.lastIndexOf("@");
  const scheme = url.indexOf("://");
  const hostStart = at >= 0 ? at + 1 : scheme >= 0 ? scheme + 3 : -1;
  if (hostStart < 0) {
    throw new Error("DATABASE_URL hostname could not be rewritten safely");
  }
  const rest = url.slice(hostStart);
  let hostLen: number;
  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end < 0) {
      throw new Error("DATABASE_URL hostname could not be rewritten safely");
    }
    hostLen = end + 1;
  } else {
    const match = rest.match(/^[^:/?#]*/);
    hostLen = match ? match[0].length : 0;
  }
  const found = rest.slice(0, hostLen);
  if (found !== oldHost && found !== `[${oldHost}]`) {
    throw new Error("DATABASE_URL hostname could not be rewritten safely");
  }
  return url.slice(0, hostStart) + newHostname + url.slice(hostStart + hostLen);
}

export function classifyPostgresConnection(url: string): PostgresConnectionClassification {
  const parsed = parsePostgresUrl(url);
  const hostname = parsed.hostname || "";
  const neon = isNeonHost(hostname);
  const reasons: string[] = [];
  if (neon) reasons.push("neon-host");
  if (hasPoolerLabel(hostname)) reasons.push("hostname-pooler-label");
  if (parsed.port === "6543") reasons.push("port-6543");
  if (parsed.searchParams.get("pgbouncer") === "true") reasons.push("pgbouncer-param");

  const pooled =
    (neon && hasPoolerLabel(hostname)) ||
    parsed.port === "6543" ||
    parsed.searchParams.get("pgbouncer") === "true";

  if (pooled) {
    return { mode: "transaction-pooler", neon, reasons };
  }
  if (neon) {
    return { mode: "direct", neon, reasons };
  }
  return { mode: "unknown", neon, reasons };
}

function pooledError(prefix: string): Error {
  return new Error(
    `${prefix} a transaction pooler (PgBouncer transaction mode does not keep a backend session). ` +
      "Migration pg_advisory_lock needs a session-capable connection. " +
      "Set DATABASE_URL_UNPOOLED, DIRECT_URL, or POSTGRES_URL_NON_POOLING to a direct Postgres URL. " +
      "Neon pooled hosts (*.neon.tech with a -pooler hostname label) are rewritten by removing that label only; " +
      "other hostnames are never rewritten.",
  );
}

/**
 * Connection string for the migration runner (session-level advisory lock).
 *
 * Preference:
 * 1. DATABASE_URL_UNPOOLED / DIRECT_URL / POSTGRES_URL_NON_POOLING
 * 2. Documented Neon rewrite: strip `-pooler` from a `*.neon.tech` label
 * 3. DATABASE_URL when it is direct or unclassified (local pg.Pool, RDS, …)
 *
 * Throws (fail closed) when DATABASE_URL is a detected non-Neon pooler and no
 * explicit direct URL is set. Does not blindly rewrite arbitrary hostnames.
 */
export function resolveMigrationConnectionString(databaseUrl: string): string {
  for (const key of SESSION_URL_ENV_KEYS) {
    const candidate = readTrimmedEnv(key);
    if (!candidate) continue;
    const classified = classifyPostgresConnection(candidate);
    if (classified.mode === "transaction-pooler") {
      throw pooledError(`${key} still points at`);
    }
    return candidate;
  }

  const classified = classifyPostgresConnection(databaseUrl);
  if (classified.mode !== "transaction-pooler") {
    return databaseUrl;
  }

  if (classified.neon) {
    const parsed = parsePostgresUrl(databaseUrl);
    const directHost = neonDirectHostname(parsed.hostname);
    if (directHost && directHost !== parsed.hostname) {
      const rewritten = replaceUrlHostname(databaseUrl, directHost);
      const after = classifyPostgresConnection(rewritten);
      if (after.mode === "transaction-pooler") {
        throw pooledError("Neon pooled DATABASE_URL rewrote to a host that is still");
      }
      return rewritten;
    }
  }

  throw pooledError("DATABASE_URL points at");
}
