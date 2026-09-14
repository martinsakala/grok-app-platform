import type { HealthResponse } from "./types.js";
import { getPlatformVersion } from "./platform-version.js";
import {
  getDatabase,
  getDatabaseDiagnostics,
  getDatabaseEngine,
  type Database,
} from "../database/index.js";
import { createLogger, logError } from "../logging/index.js";

const logger = createLogger("health");

/**
 * Health payload with a safe database probe. Never includes connection
 * details, credentials, filesystem paths, or raw driver errors.
 */
export async function getHealthResponse(database?: Database): Promise<HealthResponse> {
  const platformVersion = getPlatformVersion();
  const engine = getDatabaseEngine();
  try {
    const db = database ?? (await getDatabase());
    const diagnostics = await getDatabaseDiagnostics(db);
    if (diagnostics.connected && diagnostics.migrationsReady) {
      return {
        status: "ok",
        platformVersion,
        database: { status: "ok", engine },
      };
    }
    return {
      status: "degraded",
      platformVersion,
      database: { status: "error", engine },
    };
  } catch (error) {
    logError(logger, error, "database health check failed");
    return {
      status: "degraded",
      platformVersion,
      database: { status: "error", engine },
    };
  }
}
