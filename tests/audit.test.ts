import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAccessPolicy, setRoles } from "../src/access/index.js";
import { createApiKey, revokeApiKey } from "../src/api-keys/index.js";
import { audit, listAudit, redactAuditMeta } from "../src/audit/index.js";
import {
  createAuthSessionSource,
  requirePrincipal,
  type AuthUser,
} from "../src/auth/index.js";
import { resetDatabaseForTests, runMigrations } from "../src/database/index.js";
import { setLogSink, type LogEntry } from "../src/logging/index.js";
import { setSetting, deleteSetting } from "../src/settings/index.js";

const alice: AuthUser = { id: "user-alice", email: "alice@example.com", name: "Alice", image: null };
const bob: AuthUser = { id: "user-bob", email: "bob@example.com", name: "Bob", image: null };

function source(user: AuthUser) {
  return createAuthSessionSource({
    async getSession() {
      return { user };
    },
  });
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  await resetDatabaseForTests();
  await runMigrations();
});

afterEach(async () => {
  setLogSink(null);
  await resetDatabaseForTests();
});

describe("audit log", () => {
  it("records bootstrap, auto-member, roles, policy, api keys, and settings", async () => {
    const owner = await requirePrincipal(source(alice));
    const member = await requirePrincipal(source(bob));
    await setRoles(owner, bob.id, ["admin"]);
    await setAccessPolicy(owner, { mode: "allowlist", allowed_emails: ["bob@example.com"], allowed_domains: [] });
    const created = await createApiKey(owner, { name: "ci", roles: ["member"] });
    await revokeApiKey(owner, created.id);
    await setSetting(owner, "app.theme", { color: "dark", password: "hunter2", token: "abc" });
    await deleteSetting(owner, "app.theme");

    const page = await listAudit(owner, { limit: 100 });
    const actions = page.entries.map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "owner.bootstrap",
        "member.auto",
        "roles.set",
        "access_policy.set",
        "api_key.create",
        "api_key.revoke",
        "settings.set",
        "settings.delete",
      ]),
    );
    const dumped = JSON.stringify(page.entries);
    expect(dumped).not.toMatch(/gk_/);
    expect(dumped).not.toMatch(/hunter2/);
    const setRow = page.entries.find((row) => row.action === "settings.set");
    expect(setRow?.entityId).toBe("app.theme");
    expect((setRow?.meta as { value?: { password?: string; color?: string } }).value?.password).toBe(
      "[redacted]",
    );
    expect((setRow?.meta as { value?: { color?: string } }).value?.color).toBe("dark");
    expect(member.roles).toEqual(["member"]);
  });

  it("redacts secrets from meta and paginates by id desc", async () => {
    expect(
      redactAuditMeta({
        password: "x",
        hash: "abc",
        api_key: "gk_nope",
        safe: 1,
        nested: { token: "t", ok: true },
      }),
    ).toEqual({
      password: "[redacted]",
      hash: "[redacted]",
      api_key: "[redacted]",
      safe: 1,
      nested: { token: "[redacted]", ok: true },
    });

    const owner = await requirePrincipal(source(alice));
    for (let i = 0; i < 5; i++) {
      await setSetting(owner, `app.n${i}`, i);
    }
    const first = await listAudit(owner, { limit: 2, action: "settings.set" });
    expect(first.entries).toHaveLength(2);
    expect(first.nextBefore).toBe(first.entries[1]?.id ?? null);
    expect(first.entries[0].id).toBeGreaterThan(first.entries[1].id);
    const second = await listAudit(owner, {
      limit: 2,
      action: "settings.set",
      before: first.nextBefore,
    });
    expect(second.entries).toHaveLength(2);
    expect(second.entries[0].id).toBeLessThan(first.entries[1].id);
    const ids = [...first.entries, ...second.entries].map((row) => row.id);
    expect(new Set(ids).size).toBe(4);

    await expect(listAudit(owner, { limit: 101 })).rejects.toMatchObject({ name: "BadRequestError" });
  });

  it("logs audit write failures without throwing", async () => {
    const owner = await requirePrincipal(source(alice));
    const seen: LogEntry[] = [];
    setLogSink((entry) => seen.push(entry));
    const { getInternalDatabase } = await import("../src/database/client.js");
    const db = await getInternalDatabase();
    await db.exec("drop table private.audit_log");
    await expect(
      audit(owner, { action: "settings.set", entity: "setting", entityId: "x" }),
    ).resolves.toBeUndefined();
    expect(seen.some((entry) => entry.msg === "audit write failed")).toBe(true);
  });
});
