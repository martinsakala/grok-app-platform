import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../src/auth/types.js";
import { getDatabase, resetDatabaseForTests, runMigrations } from "../src/database/index.js";
import {
  csvCell,
  csvHeader,
  csvRow,
  defineDataApi,
  exportResource,
  ndjsonRow,
  resolveExportMaxRows,
} from "../src/data-api/index.js";

const alice: AuthUser = { id: "user-alice", email: "a@example.com", name: "Alice", image: null };
const bob: AuthUser = { id: "user-bob", email: "b@example.com", name: "Bob", image: null };

describe("CSV / NDJSON formatters", () => {
  it("escapes quotes, commas, newlines and prefixes formula injection", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("=1+2")).toBe("'=1+2");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-01-02T03:04:05.000Z"))).toBe("2026-01-02T03:04:05.000Z");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvHeader(["id", "value"])).toBe("id,value");
    expect(csvRow(["id", "value"], { id: "1", value: "a,b" })).toBe('1,"a,b"');
    expect(ndjsonRow({ id: "1", nested: { n: 2 } })).toBe('{"id":"1","nested":{"n":2}}');
  });

  it("lets a setting lower the cap but never raise it", () => {
    expect(resolveExportMaxRows(100, 10)).toBe(10);
    expect(resolveExportMaxRows(100, 1000)).toBe(100);
    expect(resolveExportMaxRows(undefined, 10)).toBe(10);
    expect(resolveExportMaxRows(100, null)).toBe(100);
    expect(resolveExportMaxRows(100, "3")).toBe(3);
  });
});

const resource = {
  name: "owned-items",
  relation: "owned_items",
  columns: ["id", "user_id", "value"] as const,
  ownerColumn: "user_id",
  orderBy: "id",
};

function registry() {
  return defineDataApi({ resources: [resource] });
}

async function seedEscapes() {
  await runMigrations();
  const db = await getDatabase();
  await db.query(`
    create table app.owned_items (
      id text primary key,
      user_id text not null,
      value text
    )
  `);
  await db.query(`
    create view api.owned_items as
    select id, user_id, value from app.owned_items
  `);
  await db.query(
    `insert into app.owned_items (id, user_id, value) values
      ($1,$2,$3),($4,$5,$6),($7,$8,$9),($10,$11,$12),($13,$14,$15)`,
    [
      "a1",
      alice.id,
      'say "hi"',
      "a2",
      alice.id,
      "a,b",
      "a3",
      alice.id,
      "line\nbreak",
      "a4",
      alice.id,
      "=1+2",
      "b1",
      bob.id,
      "bob-secret",
    ],
  );
  return db;
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const text = await new Response(stream).text();
  return text;
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  await resetDatabaseForTests();
});

afterEach(async () => {
  await resetDatabaseForTests();
});

describe("exportResource", () => {
  it("streams CSV with escaping and does not include another owner's rows", async () => {
    const db = await seedEscapes();
    const exported = await exportResource(
      registry(),
      db,
      { resource: "owned-items", user: alice, format: "csv" },
      { maxRows: 100 },
    );
    expect(exported.truncated).toBe(false);
    expect(exported.rows).toBe(4);
    const body = await readStream(exported.body);
    expect(body.startsWith("id,user_id,value\n")).toBe(true);
    expect(body).toContain('"say ""hi"""');
    expect(body).toContain('"a,b"');
    expect(body).toContain('"line\nbreak"');
    expect(body).toContain("'=1+2");
    expect(body).not.toContain("bob-secret");
  });

  it("streams NDJSON and truncates at the cap", async () => {
    const db = await seedEscapes();
    const exported = await exportResource(
      registry(),
      db,
      { resource: "owned-items", user: alice, format: "json", limit: 2 },
      { maxRows: 100 },
    );
    expect(exported.truncated).toBe(true);
    expect(exported.rows).toBe(2);
    const body = await readStream(exported.body);
    const lines = body.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ id: "a1" });
    expect(body).not.toContain("bob-secret");
  });
});
