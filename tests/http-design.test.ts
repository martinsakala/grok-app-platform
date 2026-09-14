import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthSessionSource, requirePrincipal, type AuthUser } from "../src/auth/index.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";
import { createPlatformHandler } from "../src/http/index.js";
import { setLogSink } from "../src/logging/index.js";
import { defineAppConfig } from "../src/runtime/app-config.js";
import { setSetting } from "../src/settings/index.js";

const alice: AuthUser = { id: "user-alice", email: "alice@example.com", name: "Alice", image: null };
const bob: AuthUser = { id: "user-bob", email: "bob@example.com", name: "Bob", image: null };

const appConfig = defineAppConfig({
  name: "http-test",
  version: "0.0.0",
  dataApiVersion: "0.5.1",
});

const BUILD_TOKENS = {
  "--pf-bg": "#0f1115",
  "--pf-accent": "#6ea8fe",
  "--pf-fg": "#e8eaed",
};

function sourceFor(user: AuthUser | null) {
  return () =>
    createAuthSessionSource({
      async getSession() {
        return user ? { user } : null;
      },
    });
}

function handlerFor(user: AuthUser | null) {
  return createPlatformHandler({
    appConfig,
    sessionSource: sourceFor(user),
    getDatabase,
    designTokens: BUILD_TOKENS,
  });
}

async function call(
  handle: (request: Request) => Promise<Response>,
  path: string,
  init: RequestInit = {},
) {
  const response = await handle(new Request(`https://example.test${path}`, init));
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, headers: response.headers, text };
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  setLogSink(() => undefined);
  await resetDatabaseForTests();
  await runMigrations();
});

afterEach(async () => {
  setLogSink(null);
  await resetDatabaseForTests();
});

describe("platform HTTP design", () => {
  it("GET /design is public, secret-free, and returns build-time tokens", async () => {
    const { status, body, text } = await call(handlerFor(null), "/api/platform/design");
    expect(status).toBe(200);
    const payload = body as { tokens: Record<string, string>; override: unknown };
    expect(payload.tokens["--pf-bg"]).toBe("#0f1115");
    expect(payload.tokens["--pf-accent"]).toBe("#6ea8fe");
    expect(payload.override).toBeNull();
    expect(text).not.toMatch(/password|secret|hash|gk_/i);
    expect((body as { tokens: Record<string, string> }).tokens["--pf-accent"]).toBe("#6ea8fe");
  });

  it("PUT /design is owner-only and rejects bad hex", async () => {
    const anon = await call(handlerFor(null), "/api/platform/design", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ colors: { accent: "#abcdef" } }),
    });
    expect(anon.status).toBe(401);

    await call(handlerFor(alice), "/api/platform/me");
    await call(handlerFor(bob), "/api/platform/me");

    const memberWrite = await call(handlerFor(bob), "/api/platform/design", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ colors: { accent: "#abcdef" } }),
    });
    expect(memberWrite.status).toBe(403);

    const badHex = await call(handlerFor(alice), "/api/platform/design", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ colors: { accent: "not-hex" } }),
    });
    expect(badHex.status).toBe(400);
    expect((badHex.body as { code: string }).code).toBe("bad_request");
  });

  it("PUT merges the override; GET shows it; DELETE resets; audit is design.set", async () => {
    await call(handlerFor(alice), "/api/platform/me");

    const written = await call(handlerFor(alice), "/api/platform/design", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        colors: { accent: "#ff00aa" },
        shape: { radiusMd: "2px" },
      }),
    });
    expect(written.status).toBe(200);
    const afterPut = written.body as {
      tokens: Record<string, string>;
      override: { colors?: { accent?: string } };
    };
    expect(afterPut.tokens["--pf-accent"]).toBe("#ff00aa");
    expect(afterPut.tokens["--pf-radius"]).toBe("2px");
    expect(afterPut.tokens["--pf-bg"]).toBe("#0f1115");
    expect(afterPut.override.colors?.accent).toBe("#ff00aa");

    const publicRead = await call(handlerFor(null), "/api/platform/design");
    expect(publicRead.status).toBe(200);
    expect((publicRead.body as { tokens: Record<string, string> }).tokens["--pf-accent"]).toBe(
      "#ff00aa",
    );

    const audit = await call(handlerFor(alice), "/api/platform/admin/audit?limit=20&action=design.set");
    expect(audit.status).toBe(200);
    const entries = (audit.body as { entries: { action: string; meta: unknown }[] }).entries;
    expect(entries.some((row) => row.action === "design.set")).toBe(true);
    expect(JSON.stringify(audit.body)).not.toMatch(/gk_/);

    const reset = await call(handlerFor(alice), "/api/platform/design", { method: "DELETE" });
    expect(reset.status).toBe(200);
    const afterReset = reset.body as { tokens: Record<string, string>; override: unknown };
    expect(afterReset.override).toBeNull();
    expect(afterReset.tokens["--pf-accent"]).toBe("#6ea8fe");

    const publicAfter = await call(handlerFor(null), "/api/platform/design");
    expect((publicAfter.body as { override: unknown }).override).toBeNull();
  });

  it("treats a corrupt stored override as missing so GET stays 200", async () => {
    await call(handlerFor(alice), "/api/platform/me");
    const owner = await requirePrincipal(sourceFor(alice)());
    await setSetting(owner, "platform.design", { voice: { tone: "nope" } });
    const { status, body } = await call(handlerFor(null), "/api/platform/design");
    expect(status).toBe(200);
    expect((body as { override: unknown }).override).toBeNull();
    expect((body as { tokens: Record<string, string> }).tokens["--pf-accent"]).toBe("#6ea8fe");
  });
});
