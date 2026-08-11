import type { AppConfig, VersionResponse } from "./types.js";
import { getPlatformVersion } from "./platform-version.js";

/**
 * Build a version payload from application config + platform VERSION file.
 */
export function getVersionResponse(config: AppConfig): VersionResponse {
  return {
    application: config.name,
    applicationVersion: config.version,
    platformVersion: getPlatformVersion(),
    dataApiVersion: config.dataApiVersion,
  };
}
