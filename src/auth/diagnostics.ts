import { getDatabase } from "../database/client.js";
import { assertServerOnly } from "../database/server-guard.js";
import type { Database } from "../database/types.js";
import type { AuthDiagnostics } from "./types.js";

async function relationExists(db: Database, qualifiedName: string): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    "select to_regclass($1) is not null as exists",
    [qualifiedName],
  );
  return result.rows[0]?.exists === true;
}

/**
 * Safe auth probe. Unsigned-in is not an error and is not reported.
 * Never returns tokens, secrets, env values, or the current user.
 */
export async function getAuthDiagnostics(database?: Database): Promise<AuthDiagnostics> {
  assertServerOnly("@platform/auth");
  try {
    const db = database ?? (await getDatabase());
    const [user, session, account, verification] = await Promise.all([
      relationExists(db, "public.user"),
      relationExists(db, "public.session"),
      relationExists(db, "public.account"),
      relationExists(db, "public.verification"),
    ]);
    return {
      schemaReady: user && session && account && verification,
    };
  } catch {
    console.error("[platform] auth diagnostics failed");
    return { schemaReady: false };
  }
}
