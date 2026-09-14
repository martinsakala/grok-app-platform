import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../src/auth/types.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";
import {
  DataApiError,
  MAX_PAGE_SIZE,
  defineDataApi,
  listResource,
} from "../src/data-api/index.js";

const alice: AuthUser = { id: "user-alice", email: "a@example.com", name: "Alice", image: null };
const bob: AuthUser = { id: "user-bob", email: "b@example.com", name: "Bob", image: null };

async function seedRank() {
  await runMigrations();
  const db = await getDatabase();
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

async function seedTyped() {
  await runMigrations();
  const db = await getDatabase();
  await db.query(`
    create table app.typed_items (
      id uuid primary key,
      user_id text not null,
      rank int not null,
      label text not null,
      created_at timestamptz not null
    )
  `);
  await db.query(`
    create view api.typed_items as
    select id, user_id, rank, label, created_at
    from app.typed_items
  `);
  const rows = [
    ["11111111-1111-4111-8111-111111111111", 1, "alpha", "2026-01-01T00:00:00Z"],
    ["22222222-2222-4222-8222-222222222222", 2, "bravo", "2026-01-02T00:00:00Z"],
    ["33333333-3333-4333-8333-333333333333", 3, "charlie", "2026-01-03T00:00:00Z"],
    ["44444444-4444-4444-8444-444444444444", 4, "delta", "2026-01-04T00:00:00Z"],
    ["55555555-5555-4555-8555-555555555555", 5, "echo", "2026-01-05T00:00:00Z"],
  ] as const;
  for (const [id, rank, label, created] of rows) {
    await db.query(
      `insert into app.typed_items (id, user_id, rank, label, created_at) values ($1, $2, $3, $4, $5)`,
      [id, alice.id, rank, label, created],
    );
  }
  await db.query(
    `insert into app.typed_items (id, user_id, rank, label, created_at) values ($1, $2, $3, $4, $5)`,
    ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", bob.id, 1, "bob", "2026-01-01T00:00:00Z"],
  );
  return db;
}

function rankApi(direction: "asc" | "desc" = "asc", orderBy = "rank", uniqueBy = "item_key") {
  return defineDataApi({
    resources: [
      {
        name: "rank-items",
        relation: "rank_items",
        columns: ["title", "rank"],
        ownerColumn: "user_id",
        orderBy,
        uniqueBy,
        orderDirection: direction,
      },
      {
        name: "rank-by-key",
        relation: "rank_items",
        columns: ["title", "rank"],
        ownerColumn: "user_id",
        orderBy: "item_key",
        uniqueBy: "item_key",
        orderDirection: direction,
      },
    ],
  });
}

function typedApi(orderBy: string, uniqueBy: string, direction: "asc" | "desc" = "asc") {
  return defineDataApi({
    resources: [
      {
        name: "typed-items",
        relation: "typed_items",
        columns: ["id", "rank", "label", "created_at"],
        ownerColumn: "user_id",
        orderBy,
        uniqueBy,
        orderDirection: direction,
      },
    ],
  });
}

async function walkAll(
  api: ReturnType<typeof rankApi>,
  db: Awaited<ReturnType<typeof getDatabase>>,
  resource: string,
  user: AuthUser,
  limit: number,
) {
  const items: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await listResource(api, db, { resource, user, limit, cursor });
    items.push(...page.items);
    if (page.items.length > limit) throw new Error("page exceeded limit");
    if (page.items.length < limit) {
      expect(page.nextCursor).toBeNull();
      break;
    }
    expect(page.nextCursor).toEqual(expect.any(String));
    cursor = page.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return items;
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  await resetDatabaseForTests();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe("listResource cursor keyset", () => {
  it("walks the full set without duplicates or gaps, asc and desc, orderBy ≠ uniqueBy", async () => {
    const db = await seedRank();
    const asc = rankApi("asc");
    const desc = rankApi("desc");
    const ascTitles = (await walkAll(asc, db, "rank-items", alice, 2)).map((row) => row.title);
    const descTitles = (await walkAll(desc, db, "rank-items", alice, 2)).map((row) => row.title);
    expect(ascTitles).toEqual(["alice-k1", "alice-k2", "alice-k3", "alice-k4", "alice-k5"]);
    expect(descTitles).toEqual(["alice-k5", "alice-k4", "alice-k3", "alice-k2", "alice-k1"]);
    expect(new Set(ascTitles).size).toBe(5);
    expect(ascTitles.some((title) => String(title).startsWith("bob-"))).toBe(false);
  });

  it("walks when orderBy equals uniqueBy", async () => {
    const db = await seedRank();
    const api = rankApi("asc");
    const titles = (await walkAll(api, db, "rank-by-key", alice, 2)).map((row) => row.title);
    expect(titles).toEqual(["alice-k1", "alice-k2", "alice-k3", "alice-k4", "alice-k5"]);
    const desc = rankApi("desc");
    const down = (await walkAll(desc, db, "rank-by-key", alice, 2)).map((row) => row.title);
    expect(down).toEqual(["alice-k5", "alice-k4", "alice-k3", "alice-k2", "alice-k1"]);
  });

  it("does not return uniqueBy unless it is in columns", async () => {
    const db = await seedRank();
    const api = rankApi("asc");
    const page = await listResource(api, db, { resource: "rank-items", user: alice, limit: 2 });
    expect(page.items.every((row) => Object.keys(row).sort().join() === "rank,title")).toBe(true);
    expect(page.items.some((row) => "item_key" in row)).toBe(false);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.offset).toBe(0);
  });

  it("ignores offset when a cursor is present", async () => {
    const db = await seedRank();
    const api = rankApi("asc");
    const first = await listResource(api, db, { resource: "rank-items", user: alice, limit: 2 });
    const next = await listResource(api, db, {
      resource: "rank-items",
      user: alice,
      limit: 2,
      cursor: first.nextCursor,
      offset: 99,
    });
    expect(next.offset).toBe(0);
    expect(next.items.map((row) => row.title)).toEqual(["alice-k3", "alice-k4"]);
  });

  it("keeps offset pagination working and still emits nextCursor", async () => {
    const db = await seedRank();
    const api = rankApi("asc");
    const page = await listResource(api, db, {
      resource: "rank-items",
      user: alice,
      limit: 2,
      offset: 2,
    });
    expect(page.offset).toBe(2);
    expect(page.items.map((row) => row.title)).toEqual(["alice-k3", "alice-k4"]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const viaCursor = await listResource(api, db, {
      resource: "rank-items",
      user: alice,
      limit: 2,
      cursor: page.nextCursor,
    });
    expect(viaCursor.items.map((row) => row.title)).toEqual(["alice-k5"]);
    expect(viaCursor.nextCursor).toBeNull();
  });

  it("inserts in the middle of a walk without duplicating or dropping later rows", async () => {
    const db = await seedRank();
    const api = rankApi("asc");
    const first = await listResource(api, db, { resource: "rank-by-key", user: alice, limit: 2 });
    expect(first.items.map((row) => row.title)).toEqual(["alice-k1", "alice-k2"]);
    await db.query(
      `insert into app.rank_items (item_key, user_id, title, rank) values
        ('k0', $1, 'alice-k0', 0),
        ('k15', $1, 'alice-k15', 1),
        ('k25', $1, 'alice-k25', 1)`,
      [alice.id],
    );
    const rest: unknown[] = [];
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await listResource(api, db, {
        resource: "rank-by-key",
        user: alice,
        limit: 2,
        cursor,
      });
      rest.push(...page.items.map((row) => row.title));
      cursor = page.nextCursor;
    }
    expect(rest).toEqual(["alice-k25", "alice-k3", "alice-k4", "alice-k5"]);
    expect(rest).not.toContain("alice-k0");
    expect(rest).not.toContain("alice-k1");
    expect(rest).not.toContain("alice-k15");
    expect(rest).not.toContain("alice-k2");
    expect(new Set(rest).size).toBe(rest.length);
  });

  it("does not leak another owner's rows when given that owner's cursor", async () => {
    const db = await seedRank();
    const api = rankApi("asc");
    const bobPage = await listResource(api, db, { resource: "rank-items", user: bob, limit: 1 });
    expect(bobPage.items.map((row) => row.title)).toEqual(["bob-k1"]);
    const aliceWithBobCursor = await listResource(api, db, {
      resource: "rank-items",
      user: alice,
      limit: 10,
      cursor: bobPage.nextCursor ?? undefined,
    });
    expect(aliceWithBobCursor.items.every((row) => String(row.title).startsWith("alice-"))).toBe(true);
    expect(aliceWithBobCursor.items.some((row) => String(row.title).startsWith("bob-"))).toBe(false);

    const alicePage = await listResource(api, db, { resource: "rank-items", user: alice, limit: 2 });
    const bobWithAliceCursor = await listResource(api, db, {
      resource: "rank-items",
      user: bob,
      limit: 10,
      cursor: alicePage.nextCursor,
    });
    expect(bobWithAliceCursor.items.some((row) => String(row.title).startsWith("alice-"))).toBe(false);
  });
});

describe("listResource cursor errors", () => {
  it("rejects a forged or badly signed cursor with 400 invalid_cursor, never 500", async () => {
    const db = await seedRank();
    const api = rankApi("asc");
    const first = await listResource(api, db, { resource: "rank-items", user: alice, limit: 2 });
    const valid = first.nextCursor as string;
    const [payload, sig] = valid.split(".");
    const flipped = `${payload}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    const unsigned = `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const garbage = "not-a-cursor";
    const emptySig = `${payload}.`;
    for (const cursor of [flipped, unsigned, garbage, emptySig, "a.b.c", payload]) {
      await expect(
        listResource(api, db, { resource: "rank-items", user: alice, limit: 2, cursor }),
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(DataApiError);
        const failure = error as DataApiError;
        expect(failure.status).toBe(400);
        expect(failure.code).toBe("invalid_cursor");
        expect(failure.message).toBe("Invalid cursor");
        expect(JSON.stringify(failure)).not.toMatch(/DATABASE_URL|hmac|sha256|postgres:\/\//i);
        return true;
      });
    }
  });

  it("rejects a cursor issued for a different resource", async () => {
    const db = await seedRank();
    const api = rankApi("asc");
    const fromKey = await listResource(api, db, { resource: "rank-by-key", user: alice, limit: 2 });
    await expect(
      listResource(api, db, {
        resource: "rank-items",
        user: alice,
        limit: 2,
        cursor: fromKey.nextCursor,
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_cursor" });
  });

  it("still enforces the limit cap when a cursor is present", async () => {
    const db = await seedRank();
    const api = rankApi("asc");
    const first = await listResource(api, db, { resource: "rank-items", user: alice, limit: 2 });
    await expect(
      listResource(api, db, {
        resource: "rank-items",
        user: alice,
        limit: MAX_PAGE_SIZE + 1,
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_input" });
  });
});

describe("listResource cursor column types", () => {
  it("pages across timestamptz, integer, text, and uuid keys", async () => {
    const db = await seedTyped();
    const cases = [
      { orderBy: "created_at", uniqueBy: "id", labels: ["alpha", "bravo", "charlie", "delta", "echo"] },
      { orderBy: "rank", uniqueBy: "id", labels: ["alpha", "bravo", "charlie", "delta", "echo"] },
      { orderBy: "label", uniqueBy: "id", labels: ["alpha", "bravo", "charlie", "delta", "echo"] },
      { orderBy: "id", uniqueBy: "id", labels: ["alpha", "bravo", "charlie", "delta", "echo"] },
    ] as const;
    for (const testCase of cases) {
      const api = typedApi(testCase.orderBy, testCase.uniqueBy, "asc");
      const items: Record<string, unknown>[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await listResource(api, db, {
          resource: "typed-items",
          user: alice,
          limit: 2,
          cursor,
        });
        items.push(...page.items);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(items.map((row) => row.label), testCase.orderBy).toEqual([...testCase.labels]);
      expect(items.every((row) => typeof row.id === "string")).toBe(true);
      const desc = typedApi(testCase.orderBy, testCase.uniqueBy, "desc");
      const down = (await walkAll(desc, db, "typed-items", alice, 2)).map((row) => row.label);
      expect(down).toEqual([...testCase.labels].reverse());
    }
  });
});
