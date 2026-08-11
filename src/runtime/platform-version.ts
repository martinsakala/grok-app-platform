import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve platform root (directory that contains VERSION).
 * From src/runtime → ../../VERSION when consumed as source under /platform or this repo.
 */
function resolvePlatformRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

let cached: string | undefined;

/**
 * Reads platform version from the platform VERSION file (not a hand-duplicated constant).
 */
export function getPlatformVersion(): string {
  if (cached === undefined) {
    const versionPath = join(resolvePlatformRoot(), "VERSION");
    cached = readFileSync(versionPath, "utf8").trim();
    if (!cached) {
      throw new Error(`Platform VERSION file is empty: ${versionPath}`);
    }
  }
  return cached;
}

/** Test helper — clears cache so VERSION file changes are visible. */
export function clearPlatformVersionCache(): void {
  cached = undefined;
}
