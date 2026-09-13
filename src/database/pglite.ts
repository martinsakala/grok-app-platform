import { PGlite } from "@electric-sql/pglite";
import { wrapPglite } from "./adapter.js";
import type { InternalDatabase } from "./internal.js";

export async function createPgliteDatabase(): Promise<InternalDatabase> {
  const pg = new PGlite();
  await pg.waitReady;
  return wrapPglite(pg);
}
