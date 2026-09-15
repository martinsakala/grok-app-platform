import type { Capability } from "./types.js";

export type HttpRouteRef = { method: string; pattern: string };

export function handlerPatternFromCapabilityPath(path: string): string {
  let rest = path;
  if (rest.startsWith("/api/platform")) rest = rest.slice("/api/platform".length) || "/";
  return rest.replaceAll(/\{([A-Za-z0-9_]+)\}/g, ":$1");
}

export function capabilityCoversRoute(capability: Pick<Capability, "method" | "path">, route: HttpRouteRef): boolean {
  if (capability.method.toUpperCase() !== route.method.toUpperCase()) return false;
  const capPattern = handlerPatternFromCapabilityPath(capability.path);
  if (capPattern === route.pattern) return true;
  const routeSegs = route.pattern.split("/").filter(Boolean);
  const capSegs = capPattern.split("/").filter(Boolean);
  if (routeSegs.length !== capSegs.length) return false;
  for (let i = 0; i < routeSegs.length; i++) {
    const expected = routeSegs[i] ?? "";
    const actual = capSegs[i] ?? "";
    if (expected.startsWith(":")) continue;
    if (expected !== actual) return false;
  }
  return true;
}

export function assertRegistryCoversRoutes(
  capabilities: readonly Pick<Capability, "method" | "path">[],
  routes: readonly HttpRouteRef[],
): void {
  const missing: string[] = [];
  for (const route of routes) {
    const covered = capabilities.some((capability) => capabilityCoversRoute(capability, route));
    if (!covered) missing.push(`${route.method} ${route.pattern}`);
  }
  if (missing.length) {
    throw new Error(`registry missing handler routes: ${missing.join(", ")}`);
  }
}
