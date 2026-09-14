import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRoles } from "../src/access/index.js";
import {
  createAuthSessionSource,
  requirePrincipal,
  type AuthUser,
} from "../src/auth/index.js";
import { resetDatabaseForTests, runMigrations } from "../src/database/index.js";
import {
  deleteSetting,
  getSetting,
  listSettings,
  MAX_SETTING_BYTES,
  setSetting,
} from "../src/settings/index.js";

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
  await resetDatabaseForTests();
});

describe("settings", () => {
  it("lets members read, admins write, and reserves platform.* for owner", async () => {
    const owner = await requirePrincipal(source(alice));
    await requirePrincipal(source(bob));
    await setRoles(owner, bob.id, ["admin"]);
    const admin = await requirePrincipal(source(bob));

    await setSetting(admin, "app.theme", { color: "dark" });
    expect(await getSetting("app.theme", null)).toEqual({ color: "dark" });

    const listed = await listSettings(admin);
    expect(listed.map((row) => row.key)).toContain("app.theme");

    await expect(setSetting(admin, "platform.flag", true)).rejects.toMatchObject({
      name: "ForbiddenError",
    });
    await setSetting(owner, "platform.flag", true);
    expect(await getSetting("platform.flag", false)).toBe(true);

    const memberOnly = await requirePrincipal(
      createAuthSessionSource({
        async getSession() {
          return { user: { id: "user-cara", email: "cara@example.com", name: "Cara", image: null } };
        },
      }),
    );
    expect(memberOnly.roles).toEqual(["member"]);
    const readable = await listSettings(memberOnly);
    expect(readable.some((row) => row.key === "app.theme")).toBe(true);
    await expect(setSetting(memberOnly, "app.theme", { color: "light" })).rejects.toMatchObject({
      name: "ForbiddenError",
    });
  });

  it("rejects invalid keys and oversized values", async () => {
    const owner = await requirePrincipal(source(alice));
    await expect(setSetting(owner, "Bad Key", 1)).rejects.toMatchObject({ name: "BadRequestError" });
    await expect(setSetting(owner, "1abc", 1)).rejects.toMatchObject({ name: "BadRequestError" });
    await expect(getSetting("NOPE", 0)).rejects.toMatchObject({ name: "BadRequestError" });
    const tooBig = "x".repeat(MAX_SETTING_BYTES);
    await expect(setSetting(owner, "app.blob", tooBig)).rejects.toMatchObject({
      name: "BadRequestError",
    });
    await setSetting(owner, "app.ok", { n: 1 });
    await deleteSetting(owner, "app.ok");
    expect(await getSetting("app.ok", "missing")).toBe("missing");
  });
});
