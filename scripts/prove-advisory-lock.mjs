#!/usr/bin/env node
/**
 * Two-process proof that session-level pg_advisory_lock (key 0x67726b31)
 * spans the inter-file COMMIT gap and is released after success and error.
 *
 * Requires DATABASE_URL pointing at a **throwaway** Postgres. Never prints
 * the URL. Not for production data.
 *
 *   DATABASE_URL=postgres://… node scripts/prove-advisory-lock.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const LOCK_KEY = 0x67726b31;
const GAP_MS = 2000;
const ERROR_HOLD_MS = 1000;

function requireUrl() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("[prove-lock] DATABASE_URL is not set — skipping (no live Postgres).");
    process.exit(2);
  }
  return url;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withClient(fn) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  let failed = false;
  try {
    return await fn(client);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    client.release(failed);
    await pool.end();
  }
}

const role = process.argv[2];
const dir = process.argv[3];

if (role === "holder") {
  requireUrl();
  const marker = join(dir, "gap");
  await withClient(async (client) => {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    let applyError;
    try {
      await client.query("BEGIN");
      await client.query("drop table if exists lock_probe_a, lock_probe_b");
      await client.query("create table lock_probe_a (id int)");
      await client.query("COMMIT");
      writeFileSync(marker, "gap");
      await sleep(GAP_MS);
      await client.query("BEGIN");
      await client.query("create table lock_probe_b (id int)");
      await client.query("COMMIT");
    } catch (error) {
      applyError = error;
    }
    try {
      await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    } catch (unlockError) {
      if (!applyError) throw unlockError;
    }
    if (applyError) throw applyError;
  });
  process.exit(0);
}

if (role === "waiter") {
  requireUrl();
  const marker = join(dir, "gap");
  const started = Date.now();
  while (!existsSync(marker)) {
    if (Date.now() - started > 15_000) throw new Error("waiter: gap marker timeout");
    await sleep(50);
  }
  const result = await withClient(async (client) => {
    const t0 = Date.now();
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    const waitedMs = Date.now() - t0;
    const table = await client.query(
      "select to_regclass('public.lock_probe_b') is not null as exists",
    );
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    return { waitedMs, secondTableExisted: table.rows[0]?.exists === true };
  });
  writeFileSync(join(dir, "waiter.json"), JSON.stringify(result));
  process.exit(0);
}

if (role === "error-holder") {
  requireUrl();
  const marker = join(dir, "error-gap");
  try {
    await withClient(async (client) => {
      await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
      let applyError;
      try {
        await client.query("BEGIN");
        await client.query("drop table if exists lock_probe_err");
        await client.query("create table lock_probe_err (id int)");
        await client.query("COMMIT");
        writeFileSync(marker, "hold");
        await sleep(ERROR_HOLD_MS);
        throw new Error("simulated migration failure");
      } catch (error) {
        applyError = error;
      }
      try {
        await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
      } catch (unlockError) {
        if (!applyError) throw unlockError;
      }
      if (applyError) throw applyError;
    });
  } catch {
    process.exit(0);
  }
  process.exit(0);
}

if (role === "error-waiter") {
  requireUrl();
  const marker = join(dir, "error-gap");
  const started = Date.now();
  while (!existsSync(marker)) {
    if (Date.now() - started > 15_000) throw new Error("error-waiter: marker timeout");
    await sleep(50);
  }
  const result = await withClient(async (client) => {
    const t0 = Date.now();
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    const waitedMs = Date.now() - t0;
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    return { waitedMs, acquired: true };
  });
  writeFileSync(join(dir, "error-waiter.json"), JSON.stringify(result));
  process.exit(0);
}

if (role) {
  console.error(`[prove-lock] unknown role ${role}`);
  process.exit(1);
}

requireUrl();

const self = fileURLToPath(import.meta.url);
const work = mkdtempSync(join(tmpdir(), "grok-lock-"));

function spawnRole(name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [self, name, work], {
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${name} timed out`));
    }, 20_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${name} exited ${code}`));
    });
    child.on("error", reject);
  });
}

try {
  const success = Promise.all([spawnRole("holder"), spawnRole("waiter")]);
  await success;
  const waiter = JSON.parse(readFileSync(join(work, "waiter.json"), "utf8"));
  if (waiter.waitedMs < GAP_MS - 200) {
    throw new Error(
      `second runner did not wait through the inter-file gap (waited ${waiter.waitedMs}ms)`,
    );
  }
  if (waiter.secondTableExisted !== true) {
    throw new Error("second runner acquired the lock before the first run finished file 2");
  }
  console.log(
    `[prove-lock] success: waiter blocked ${waiter.waitedMs}ms through the inter-file gap; lock_probe_b already existed`,
  );

  const errorRun = Promise.all([spawnRole("error-holder"), spawnRole("error-waiter")]);
  await errorRun;
  const errorWaiter = JSON.parse(readFileSync(join(work, "error-waiter.json"), "utf8"));
  if (errorWaiter.acquired !== true) {
    throw new Error("lock was not acquired after the first runner errored");
  }
  if (errorWaiter.waitedMs < ERROR_HOLD_MS - 200) {
    throw new Error(
      `error-waiter did not wait for the failing holder (waited ${errorWaiter.waitedMs}ms)`,
    );
  }
  if (errorWaiter.waitedMs > 10_000) {
    throw new Error("lock was not released after the first runner errored");
  }
  console.log(
    `[prove-lock] error: waiter blocked ${errorWaiter.waitedMs}ms then acquired after unlock-on-error`,
  );
  console.log("[prove-lock] ok");
} finally {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
