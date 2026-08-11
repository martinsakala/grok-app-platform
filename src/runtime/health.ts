import type { HealthResponse } from "./types.js";
import { getPlatformVersion } from "./platform-version.js";

/**
 * Simple platform health payload (no DB checks yet).
 */
export function getHealthResponse(): HealthResponse {
  return {
    status: "ok",
    platformVersion: getPlatformVersion(),
  };
}
