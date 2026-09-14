import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAuthSessionSource,
  hasRole,
  requirePrincipal,
  requireRole,
  ForbiddenError,
  type AuthUser,
} from "../src/auth/index.js";
import { getAccessPolicy, setAccessPolicy, setRoles } from "../src/access/index.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";

const alice: AuthUser = { id: "user-alice", email: "alice@example.com", name: "Alice", image: null };
const bob: AuthUser = { id: "user-bob", email: "bob@other.com", name: "Bob", image: null };
const cara: AuthUser = { id: "user-cara", email: "cara@allowed.test", name: "Cara", image: null };

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
  await resetDatabaseForTests();
});

describe("bootstrap and allowlist", () => {
  it("makes the first user owner and later users member (open mode)", async () => {
    const first = await requirePrincipal(source(alice));
    expect(first.kind).toBe("user");
    expect(first.roles).toEqual(["owner"]);
    const second = await requirePrincipal(source(bob));
    expect(second.roles).toEqual(["member"]);
  });

  it("serializes two first requests so only one owner exists", async () => {
    const [a, b] = await Promise.all([
      requirePrincipal(source(alice)),
      requirePrincipal(source(bob)),
    ]);
    const owners = [a, b].filter((p) => p.roles.includes("owner"));
    const members = [a, b].filter((p) => p.roles.includes("member") && !p.roles.includes("owner"));
    expect(owners).toHaveLength(1);
    expect(members).toHaveLength(1);
  });

  it("denies users outside the allowlist and lets matching email/domain through", async () => {
    const owner = await requirePrincipal(source(alice));
    await setAccessPolicy(owner, {
      mode: "allowlist",
      allowed_emails: ["cara@allowed.test"],
      allowed_domains: ["example.com"],
    });
    await expect(requirePrincipal(source(bob))).rejects.toMatchObject({
      name: "ForbiddenError",
      code: "not_allowed",
    });
    const allowed = await requirePrincipal(source(cara));
    expect(allowed.roles).toEqual(["member"]);
    const stillOwner = await requirePrincipal(source(alice));
    expect(stillOwner.roles).toEqual(["owner"]);
  });

  it("lets the owner through even when their email is not on the allowlist", async () => {
    const owner = await requirePrincipal(source(alice));
    await setAccessPolicy(owner, {
      mode: "allowlist",
      allowed_emails: ["nobody@nope.test"],
      allowed_domains: [],
    });
    const again = await requirePrincipal(source(alice));
    expect(again.roles).toContain("owner");
  });
});

describe("requireRole hierarchy", () => {
  it("owner covers admin and member; member does not cover admin", async () => {
    const owner = await requirePrincipal(source(alice));
    expect(hasRole(owner, "admin")).toBe(true);
    expect(hasRole(owner, "member")).toBe(true);
    requireRole(owner, "admin");
    const member = await requirePrincipal(source(bob));
    expect(hasRole(member, "admin")).toBe(false);
    expect(() => requireRole(member, "admin")).toThrow(ForbiddenError);
    await expect(getAccessPolicy(member)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to drop the last owner", async () => {
    const owner = await requirePrincipal(source(alice));
    await expect(setRoles(owner, alice.id, ["member"])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("forbids an admin from changing an owner", async () => {
    const owner = await requirePrincipal(source(alice));
    await requirePrincipal(source(bob));
    await setRoles(owner, bob.id, ["admin"]);
    const admin = await requirePrincipal(source(bob));
    await expect(setRoles(admin, alice.id, ["member"])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setRoles(admin, bob.id, ["owner"])).rejects.toBeInstanceOf(ForbiddenError);
  });
});
