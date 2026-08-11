import type { AppConfig } from "./types.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates and freezes an application-supplied AppConfig.
 * This is the primary extension point: apps define config; platform does not own app identity.
 */
export function defineAppConfig(config: AppConfig): AppConfig {
  if (!isNonEmptyString(config.name)) {
    throw new TypeError("AppConfig.name must be a non-empty string");
  }
  if (!isNonEmptyString(config.version)) {
    throw new TypeError("AppConfig.version must be a non-empty string");
  }
  if (!isNonEmptyString(config.dataApiVersion)) {
    throw new TypeError("AppConfig.dataApiVersion must be a non-empty string");
  }

  return Object.freeze({
    name: config.name.trim(),
    version: config.version.trim(),
    dataApiVersion: config.dataApiVersion.trim(),
  });
}

/**
 * Runtime type guard / assertion for untrusted inputs (e.g. loaded JSON).
 */
export function assertAppConfig(value: unknown): asserts value is AppConfig {
  if (value === null || typeof value !== "object") {
    throw new TypeError("AppConfig must be an object");
  }
  defineAppConfig(value as AppConfig);
}
