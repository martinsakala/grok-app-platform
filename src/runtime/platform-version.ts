import { PLATFORM_VERSION } from "./generated/platform-version.js";

/**
 * Returns the platform version from the generated constant (sourced from VERSION at generate time).
 */
export function getPlatformVersion(): string {
  return PLATFORM_VERSION;
}
