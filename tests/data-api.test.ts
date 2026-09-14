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
