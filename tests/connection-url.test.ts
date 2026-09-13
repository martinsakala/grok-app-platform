import { afterEach, describe, expect, it } from "vitest";
import {
  classifyPostgresConnection,
  replaceUrlHostname,
  resolveMigrationConnectionString,
} from "../src/database/connection-url.js";

const SESSION_KEYS = ["DATABASE_URL_UNPOOLED", "DIRECT_URL", "POSTGRES_URL_NON_POOLING"] as const;

afterEach(() => {
  for (const key of SESSION_KEYS) delete process.env[key];
  delete process.env.DATABASE_URL;
});

function expectNoSecrets(text: string) {
  expect(text).not.toMatch(/postgres(ql)?:\/\//i);
  expect(text).not.toMatch(/s3cret|p%40ss|ep-cool|attacker|neondb/i);
}

describe("classifyPostgresConnection", () => {
  it("treats Neon -pooler hostname as a transaction pooler", () => {
    const classified = classifyPostgresConnection(
      "postgres://u:s3cret@ep-cool-darkness-a1b2c3d4-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
    );
    expect(classified.mode).toBe("transaction-pooler");
    expect(classified.neon).toBe(true);
    expect(classified.reasons).toEqual(expect.arrayContaining(["neon-host", "hostname-pooler-label"]));
  });

  it("treats Neon hostname without -pooler as direct", () => {
    const classified = classifyPostgresConnection(
      "postgres://u:s3cret@ep-cool-darkness-a1b2c3d4.us-east-2.aws.neon.tech/neondb?sslmode=require",
    );
    expect(classified.mode).toBe("direct");
    expect(classified.neon).toBe(true);
  });

  it("treats port 6543 as a transaction pooler", () => {
    const classified = classifyPostgresConnection("postgres://u:s3cret@db.internal:6543/app");
    expect(classified.mode).toBe("transaction-pooler");
    expect(classified.neon).toBe(false);
    expect(classified.reasons).toContain("port-6543");
  });

  it("treats local Postgres as unknown (session-capable pg.Pool)", () => {
    const classified = classifyPostgresConnection("postgres://postgres:postgres@127.0.0.1:5432/app");
    expect(classified.mode).toBe("unknown");
    expect(classified.neon).toBe(false);
  });

  it("treats pgbouncer=true as a transaction pooler", () => {
    const classified = classifyPostgresConnection(
      "postgres://u:s3cret@db.internal:5432/app?pgbouncer=true",
    );
    expect(classified.mode).toBe("transaction-pooler");
    expect(classified.reasons).toContain("pgbouncer-param");
  });
});

describe("resolveMigrationConnectionString", () => {
  const neonPooled =
    "postgres://u:p%40ss@ep-cool-darkness-a1b2c3d4-pooler.us-east-2.aws.neon.tech:5432/neondb?sslmode=require";
  const neonDirect =
    "postgres://u:p%40ss@ep-cool-darkness-a1b2c3d4.us-east-2.aws.neon.tech:5432/neondb?sslmode=require";

  it("rewrites only a Neon -pooler hostname and preserves userinfo encoding", () => {
    const resolved = resolveMigrationConnectionString(neonPooled);
    expect(resolved).toBe(neonDirect);
    expect(resolved).toContain("p%40ss");
    expect(resolved).toContain("sslmode=require");
    expect(resolved).not.toContain("-pooler");
  });

  it("does not rewrite a non-Neon hostname that happens to contain -pooler", () => {
    const url = "postgres://u:s3cret@app-pooler.example.com:5432/db";
    expect(classifyPostgresConnection(url).mode).toBe("unknown");
    expect(resolveMigrationConnectionString(url)).toBe(url);
  });

  it("fails closed for port 6543 without an explicit direct URL", () => {
    const url = "postgres://u:s3cret@db.internal:6543/app";
    expect(() => resolveMigrationConnectionString(url)).toThrow(/DATABASE_URL_UNPOOLED/);
    try {
      resolveMigrationConnectionString(url);
    } catch (error) {
      expectNoSecrets(error instanceof Error ? error.message : String(error));
    }
  });

  it("prefers DATABASE_URL_UNPOOLED over a Neon rewrite", () => {
    process.env.DATABASE_URL_UNPOOLED = "postgres://u:s3cret@127.0.0.1:5432/direct";
    expect(resolveMigrationConnectionString(neonPooled)).toBe(
      "postgres://u:s3cret@127.0.0.1:5432/direct",
    );
  });

  it("prefers DIRECT_URL then POSTGRES_URL_NON_POOLING", () => {
    process.env.DIRECT_URL = "postgres://u:s3cret@127.0.0.1:5432/direct";
    process.env.POSTGRES_URL_NON_POOLING = "postgres://u:s3cret@127.0.0.1:5432/other";
    expect(resolveMigrationConnectionString(neonPooled)).toBe(
      "postgres://u:s3cret@127.0.0.1:5432/direct",
    );
  });

  it("rejects an explicit unpooled env var that is still pooled", () => {
    process.env.DATABASE_URL_UNPOOLED =
      "postgres://u:s3cret@ep-cool-darkness-a1b2c3d4-pooler.us-east-2.aws.neon.tech/neondb";
    expect(() => resolveMigrationConnectionString(neonPooled)).toThrow(/DATABASE_URL_UNPOOLED/);
    try {
      resolveMigrationConnectionString(neonPooled);
    } catch (error) {
      expectNoSecrets(error instanceof Error ? error.message : String(error));
    }
  });

  it("returns a local URL unchanged", () => {
    const url = "postgres://postgres:postgres@127.0.0.1:5432/app";
    expect(resolveMigrationConnectionString(url)).toBe(url);
  });

  it("ignores whitespace session env vars", () => {
    process.env.DATABASE_URL_UNPOOLED = "   ";
    expect(resolveMigrationConnectionString(neonPooled)).toBe(neonDirect);
  });

  it("replaceUrlHostname preserves the rest of the string", () => {
    expect(replaceUrlHostname(neonPooled, "ep-cool-darkness-a1b2c3d4.us-east-2.aws.neon.tech")).toBe(
      neonDirect,
    );
  });
});
