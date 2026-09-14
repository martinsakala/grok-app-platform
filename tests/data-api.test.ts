import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnauthorizedError } from "../src/auth/errors.js";
import type { AuthUser } from "../src/auth/types.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";
import {
  DataApiError,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  defineDataApi,
  listResource,
} from "../src/data-api/index.js";

const alice: AuthUser = { id: "user-alice", email: "a@example.com", name: "Alice", image: null };
const bob: AuthUser = { id: "user-bob", email: "b@example.com", name: "Bob", image: null };

const resource = {
  name: "owned-items",
  relation: "owned_items",
  columns: ["id", "user_id", "value", "created_at"] as const,
  ownerColumn: "user_id",
  orderBy: "created_at",
  orderDirection: "desc" as const,
};

function registry() {
  return defineDataApi({ resources: [resource] });
}

async function seed() {
  await runMigrations();
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
    select id, user_id, value, created_at
    from app.owned_items
  `);
  await db.query(`
    create view api.unregistered_items as
    select id, user_id, value, created_at
    from app.owned_items
  `);
  await db.query(
    `insert into app.owned_items (id, user_id, value, created_at) values
      ($1, $2, $3, $4),
      ($5, $6, $7, $8),
      ($9, $10, $11, $12)`,
    [
      "a1",
      alice.id,
      "alice-1",
      "2026-01-01T00:00:00Z",
      "a2",
      alice.id,
      "alice-2",
      "2026-01-02T00:00:00Z",
      "b1",
      bob.id,
      "bob-1",
      "2026-01-03T00:00:00Z",
    ],
  );
  return db;
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  await resetDatabaseForTests();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe("defineDataApi", () => {
  it("requires ownerColumn", () => {
    expect(() =>
      defineDataApi({
        resources: [
          {
            name: "owned-items",
            relation: "owned_items",
            columns: ["id"],
            ownerColumn: "",
            orderBy: "id",
          },
        ],
      }),
    ).toThrow(/ownerColumn/);
  });

  it("rejects SELECT * style empty columns", () => {
    expect(() =>
      defineDataApi({
        resources: [
          {
            name: "owned-items",
            relation: "owned_items",
            columns: [],
            ownerColumn: "user_id",
            orderBy: "id",
          },
        ],
      }),
    ).toThrow(/columns/);
  });

  it("rejects schema-qualified relations and Better Auth tables", () => {
    const attempts = [
      {
        name: "users",
        relation: "public.user",
        columns: ["id"],
        ownerColumn: "id",
        orderBy: "id",
      },
      {
        name: "app-items",
        relation: "app.owned_items",
        columns: ["id"],
        ownerColumn: "user_id",
        orderBy: "id",
      },
      {
        name: "private-hist",
        relation: "private.platform_migrations",
        columns: ["id"],
        ownerColumn: "id",
        orderBy: "id",
      },
    ] as const;
    for (const attempt of attempts) {
      try {
        defineDataApi({ resources: [attempt] });
        throw new Error(`expected ${attempt.relation} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(DataApiError);
        expect(error).toMatchObject({ status: 403, code: "forbidden" });
      }
    }
  });

  it("rejects SQL identifier injection at registration", () => {
    expect(() =>
      defineDataApi({
        resources: [
          {
            name: "owned-items",
            relation: "owned_items;drop table app.owned_items",
            columns: ["id"],
            ownerColumn: "user_id",
            orderBy: "id",
          },
        ],
      }),
    ).toThrow(DataApiError);
    expect(() =>
      defineDataApi({
        resources: [
          {
            name: "owned-items",
            relation: "owned_items",
            columns: ["id, user_id"],
            ownerColumn: "user_id",
            orderBy: "id",
          },
        ],
      }),
    ).toThrow(DataApiError);
  });
});

describe("listResource isolation", () => {
  it("lets each user see only their rows", async () => {
    const db = await seed();
    const api = registry();
    const aliceRows = await listResource(api, db, { resource: "owned-items", user: alice });
    const bobRows = await listResource(api, db, { resource: "owned-items", user: bob });
    expect(aliceRows.items.map((row) => row.id)).toEqual(["a2", "a1"]);
    expect(aliceRows.items.every((row) => row.user_id === alice.id)).toBe(true);
    expect(bobRows.items.map((row) => row.id)).toEqual(["b1"]);
    expect(bobRows.items[0]?.user_id).toBe(bob.id);
  });

  it("ignores a client-supplied user_id", async () => {
    const db = await seed();
    const api = registry();
    const rows = await listResource(api, db, {
      resource: "owned-items",
      user: alice,
      user_id: bob.id,
    });
    expect(rows.items.map((row) => row.id)).toEqual(["a2", "a1"]);
    expect(rows.items.some((row) => row.user_id === bob.id)).toBe(false);
  });

  it("rejects anonymous access", async () => {
    const db = await seed();
    const api = registry();
    await expect(listResource(api, db, { resource: "owned-items", user: null })).rejects.toSatisfy(
      (error: unknown) => error instanceof UnauthorizedError && error.status === 401,
    );
  });
});

describe("listResource allowlist and inputs", () => {
  it("rejects an unregistered resource even when the api view exists", async () => {
    const db = await seed();
    const api = registry();
    await expect(
      listResource(api, db, { resource: "unregistered-items", user: alice }),
    ).rejects.toMatchObject({ status: 404, code: "unknown_resource" });
  });

  it("rejects attempts to name public, private, or app objects as the resource", async () => {
    const db = await seed();
    const api = registry();
    await expect(listResource(api, db, { resource: "public.user", user: alice })).rejects.toMatchObject({
      status: 400,
      code: "invalid_input",
    });
    await expect(listResource(api, db, { resource: "app.owned_items", user: alice })).rejects.toMatchObject(
      {
        status: 400,
        code: "invalid_input",
      },
    );
  });

  it("rejects SQL injection in the resource name", async () => {
    const db = await seed();
    const api = registry();
    await expect(
      listResource(api, db, {
        resource: "owned-items; drop table app.owned_items --",
        user: alice,
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_input" });
    const stillThere = await db.query<{ n: number }>("select count(*)::int as n from app.owned_items");
    expect(stillThere.rows[0]?.n).toBe(3);
  });

  it("applies default and max page size and deterministic order", async () => {
    const db = await seed();
    const api = registry();
    const defaults = await listResource(api, db, { resource: "owned-items", user: alice });
    expect(defaults.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(defaults.offset).toBe(0);
    expect(defaults.items.map((row) => row.id)).toEqual(["a2", "a1"]);

    const page = await listResource(api, db, {
      resource: "owned-items",
      user: alice,
      limit: 1,
      offset: 1,
    });
    expect(page.items.map((row) => row.id)).toEqual(["a1"]);

    await expect(
      listResource(api, db, { resource: "owned-items", user: alice, limit: MAX_PAGE_SIZE + 1 }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_input" });
    await expect(
      listResource(api, db, { resource: "owned-items", user: alice, limit: 0 }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_input" });
    await expect(
      listResource(api, db, { resource: "owned-items", user: alice, offset: -1 }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_input" });
    await expect(
      listResource(api, db, { resource: "owned-items", user: alice, limit: "1;drop" }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_input" });
  });

  it("does not leak SQL or schema in query failures", async () => {
    const db = await seed();
    const api = defineDataApi({
      resources: [
        {
          name: "missing-view",
          relation: "does_not_exist",
          columns: ["id", "user_id"],
          ownerColumn: "user_id",
          orderBy: "id",
        },
      ],
    });
    await expect(listResource(api, db, { resource: "missing-view", user: alice })).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(DataApiError);
        const failure = error as DataApiError;
        expect(failure.status).toBe(500);
        expect(failure.code).toBe("query_failed");
        expect(failure.message).toBe("Resource query failed");
        expect(JSON.stringify(failure)).not.toMatch(/does_not_exist|api\.|owned_items|sql|postgres/i);
        return true;
      },
    );
  });

  it("returns only declared columns", async () => {
    const db = await seed();
    const api = registry();
    const rows = await listResource(api, db, { resource: "owned-items", user: alice, limit: 1 });
    expect(Object.keys(rows.items[0] ?? {}).sort()).toEqual(
      ["created_at", "id", "user_id", "value"].sort(),
    );
  });
});

const rankResource = {
  name: "rank-items",
  relation: "rank_items",
  columns: ["title", "rank"] as const,
  ownerColumn: "user_id",
  orderBy: "rank",
  uniqueBy: "item_key",
};

async function seedRankItems() {
  const db = await seed();
  await db.query(`
    create table app.rank_items (
      item_key text not null,
      user_id text not null,
      title text not null,
      rank int not null,
      primary key (user_id, item_key)
    )
  `);
  await db.query(`
    create view api.rank_items as
    select item_key, user_id, title, rank
    from app.rank_items
  `);
  await db.query(
    `insert into app.rank_items (item_key, user_id, title, rank) values
      ('k2', $1, 'alice-k2', 1),
      ('k1', $1, 'alice-k1', 1),
      ('k3', $1, 'alice-k3', 1),
      ('k4', $1, 'alice-k4', 2),
      ('k5', $1, 'alice-k5', 2),
      ('k1', $2, 'bob-k1', 1)`,
    [alice.id, bob.id],
  );
  return db;
}

function rankRegistry(
  overrides: Partial<{
    name: string;
    relation: string;
    columns: readonly string[];
    ownerColumn: string;
    orderBy: string;
    uniqueBy: string;
    orderDirection: "asc" | "desc";
  }> = {},
) {
  return defineDataApi({
    resources: [
      {
        ...rankResource,
        ...overrides,
      },
    ],
  });
}

describe("defineDataApi uniqueBy", () => {
  it("keeps implicit id when id is a returned column (0.5.0 host)", () => {
    const api = registry();
    expect(api.resourceByName.get("owned-items")?.uniqueBy).toBe("id");
  });

  it("rejects a resource without id in columns and without uniqueBy", () => {
    expect(() =>
      defineDataApi({
        resources: [
          {
            name: "rank-items",
            relation: "rank_items",
            columns: ["title", "rank"],
            ownerColumn: "user_id",
            orderBy: "rank",
          },
        ],
      }),
    ).toThrow(/uniqueBy/);
  });

  it("rejects a dangerous uniqueBy identifier", () => {
    expect(() =>
      rankRegistry({ uniqueBy: "item_key;drop table app.rank_items" }),
    ).toThrow(DataApiError);
    expect(() => rankRegistry({ uniqueBy: 'item_key","rank' })).toThrow(DataApiError);
  });
});

describe("listResource unique pagination", () => {
  it("pages stably when id is not returned and uniqueBy is explicit", async () => {
    const db = await seedRankItems();
    const api = rankRegistry({ orderDirection: "asc" });
    const page1 = await listResource(api, db, {
      resource: "rank-items",
      user: alice,
      limit: 2,
      offset: 0,
    });
    const page2 = await listResource(api, db, {
      resource: "rank-items",
      user: alice,
      limit: 2,
      offset: 2,
    });
    const page3 = await listResource(api, db, {
      resource: "rank-items",
      user: alice,
      limit: 2,
      offset: 4,
    });
    const titles = [...page1.items, ...page2.items, ...page3.items].map((row) => row.title);
    expect(titles).toEqual(["alice-k1", "alice-k2", "alice-k3", "alice-k4", "alice-k5"]);
    expect(new Set(titles).size).toBe(5);
    expect(page1.items.every((row) => Object.keys(row).sort().join() === "rank,title")).toBe(true);
    expect(page1.items.some((row) => "item_key" in row)).toBe(false);
  });

  it("repeats the same pages on frozen data without skip or duplicate", async () => {
    const db = await seedRankItems();
    const api = rankRegistry({ orderDirection: "asc" });
    const collect = async () => {
      const titles: unknown[] = [];
      for (const offset of [0, 2, 4]) {
        const page = await listResource(api, db, {
          resource: "rank-items",
          user: alice,
          limit: 2,
          offset,
        });
        titles.push(...page.items.map((row) => row.title));
      }
      return titles;
    };
    const first = await collect();
    const second = await collect();
    expect(first).toEqual(second);
    expect(first).toEqual(["alice-k1", "alice-k2", "alice-k3", "alice-k4", "alice-k5"]);
  });

  it("honors DESC including when the unique key is the primary orderBy", async () => {
    const db = await seedRankItems();
    const desc = rankRegistry({ orderDirection: "desc" });
    const descPage = await listResource(desc, db, {
      resource: "rank-items",
      user: alice,
      limit: 5,
    });
    expect(descPage.items.map((row) => row.title)).toEqual([
      "alice-k5",
      "alice-k4",
      "alice-k3",
      "alice-k2",
      "alice-k1",
    ]);

    const byKey = rankRegistry({ orderBy: "item_key", uniqueBy: "item_key", orderDirection: "asc" });
    const keyed = await listResource(byKey, db, { resource: "rank-items", user: alice, limit: 5 });
    expect(keyed.items.map((row) => row.title)).toEqual([
      "alice-k1",
      "alice-k2",
      "alice-k3",
      "alice-k4",
      "alice-k5",
    ]);
    expect(keyed.items.some((row) => "item_key" in row)).toBe(false);
  });

  it("keeps two-user isolation on the uniqueBy resource", async () => {
    const db = await seedRankItems();
    const api = rankRegistry();
    const aliceRows = await listResource(api, db, { resource: "rank-items", user: alice, limit: 10 });
    const bobRows = await listResource(api, db, { resource: "rank-items", user: bob, limit: 10 });
    expect(aliceRows.items).toHaveLength(5);
    expect(bobRows.items.map((row) => row.title)).toEqual(["bob-k1"]);
    expect(aliceRows.items.some((row) => String(row.title).startsWith("bob-"))).toBe(false);
  });
});
