/**
 * Database modules are Node/server-only. Call this from public entry points so
 * an accidental client-bundle import fails fast instead of shipping credentials
 * or a WASM Postgres into the browser.
 */
export function assertServerOnly(moduleName = "@platform/database"): void {
  const doc = (globalThis as { document?: unknown }).document;
  if (doc !== undefined) {
    throw new Error(
      `${moduleName} is server-only and must not be imported into a browser bundle.`,
    );
  }
}
