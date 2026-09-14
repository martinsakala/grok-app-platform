import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAuthSessionSource,
  requirePrincipal,
  type AuthUser,
} from "../src/auth/index.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../src/api-keys/index.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";
import { defineDataApi, listResource } from "../src/data-api/index.js";

const alice: AuthUser = { id: "user-alice", email: "alice@example.com", name: "Alice", image: null };
const bob: AuthUser = { id: "user-bob", email: "bob@example.com", name: "Bob", image: null };

function source(user: AuthUser) {
  return createAuthSessionSource({
    async getSession() {
      return { user };
    },
  });
}

async function seedItems() {
  const db = await getDatabase();
  await db.query(`
    create table app.owned_items (
      id text primary key,
      user_id text not null,
      value text not null,
      created_at timestamptz not null default now()
    )
  `);
  await db.query(`
    create view api.owned_items as
    select id, user_id, value, created_at from app.owned_items
  `);
  await db.query(
    `insert into app.owned_items (id, user_id, value) values ($1,$2,$3), ($4,$5,$6)`,
    ["a1", alice.id, "alice-row", "b1", bob.id, "bob-row"],
  );
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  await resetDatabaseForTests();
  await runMigrations();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe("API keys", () => {
  it("returns plaintext once, authenticates, scopes data to the owner, then 401 after revoke", async () => {
    const owner = await requirePrincipal(source(alice));
    await requirePrincipal(source(bob));
    await seedItems();
    const created = await createApiKey(owner, { name: "ci", roles: ["member"] });
    expect(created.key.startsWith("gk_")).toBe(true);
    expect(created.prefix).toBe(created.key.slice(3, 11));
    const listed = await listApiKeys(owner);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("key");
    expect(JSON.stringify(listed)).not.toMatch(/gk_/);

    const principal = await requirePrincipal(source(alice), new Request("https://x.test/", {
      headers: { authorization: `Bearer ${created.key}` },
    }));
    expect(principal.kind).toBe("api-key");
    if (principal.kind !== "api-key") throw new Error("expected api-key");
    expect(principal.ownerUserId).toBe(alice.id);

    const registry = defineDataApi({
      resources: [
        {
          name: "owned-items",
          relation: "owned_items",
          columns: ["id", "user_id", "value", "created_at"],
          ownerColumn: "user_id",
          orderBy: "id",
          uniqueBy: "id",
        },
      ],
    });
    const page = await listResource(registry, await getDatabase(), {
      resource: "owned-items",
      user: principal,
    });
    expect(page.items.map((row) => row.id)).toEqual(["a1"]);

    await revokeApiKey(owner, created.id);
    await expect(
      requirePrincipal(source(alice), new Request("https://x.test/", {
        headers: { authorization: `Bearer ${created.key}` },
      })),
    ).rejects.toMatchObject({ name: "UnauthorizedError" });
  });

  it("rejects a key whose roles exceed the creator", async () => {
    await requirePrincipal(source(alice));
    const member = await requirePrincipal(source(bob));
    await expect(createApiKey(member, { name: "too-high", roles: ["owner"] })).rejects.toMatchObject({
      name: "ForbiddenError",
    });
  });
});
