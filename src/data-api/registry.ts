import { DataApiError } from "./errors.js";
import { assertResourceName, assertSqlIdent, rejectForbiddenTarget } from "./identifiers.js";
import type {
  DataApiConfig,
  DataApiOrderDirection,
  DataApiRegistry,
  DataApiResource,
  DefinedDataApiResource,
} from "./types.js";

function unique(values: readonly string[], label: string): readonly string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`data API ${label} is duplicated`);
    }
    seen.add(value);
  }
  return values;
}

/**
 * Unique sort key, independent of returned `columns`.
 *
 * Compatibility (0.5.0 hosts): if `uniqueBy` is omitted and `id` is among
 * `columns`, `id` is the unique key. Any other omitted configuration is
 * rejected — 0.5.0 would have paginated with a non-unique ORDER BY.
 */
function resolveUniqueBy(
  resource: DataApiResource,
  name: string,
  columns: readonly string[],
): string {
  if (resource.uniqueBy !== undefined && resource.uniqueBy !== null && resource.uniqueBy !== "") {
    return assertSqlIdent(resource.uniqueBy, "uniqueBy");
  }
  if (columns.includes("id")) {
    return "id";
  }
  throw new Error(`data API resource ${name} must declare uniqueBy`);
}

function defineResource(resource: DataApiResource): DefinedDataApiResource {
  if (!resource || typeof resource !== "object") {
    throw new Error("data API resource is required");
  }
  const name = assertResourceName(resource.name);
  rejectForbiddenTarget(String(resource.relation ?? ""));
  if (typeof resource.ownerColumn !== "string" || resource.ownerColumn.trim() === "") {
    throw new Error(`data API resource ${name} must declare ownerColumn`);
  }
  const relation = assertSqlIdent(resource.relation, "relation");
  const ownerColumn = assertSqlIdent(resource.ownerColumn, "ownerColumn");
  if (!Array.isArray(resource.columns) || resource.columns.length === 0) {
    throw new Error(`data API resource ${name} must declare columns`);
  }
  const columns = unique(
    resource.columns.map((column) => assertSqlIdent(column, "column")),
    "column",
  );
  const orderBy = assertSqlIdent(resource.orderBy, "orderBy");
  const uniqueBy = resolveUniqueBy(resource, name, columns);
  const orderDirection: DataApiOrderDirection =
    resource.orderDirection === "desc" ? "desc" : resource.orderDirection === "asc" ? "asc" : "asc";
  if (resource.orderDirection && resource.orderDirection !== "asc" && resource.orderDirection !== "desc") {
    throw new Error(`data API resource ${name} has an invalid orderDirection`);
  }
  return Object.freeze({
    name,
    relation,
    columns: Object.freeze([...columns]),
    ownerColumn,
    orderBy,
    orderDirection,
    uniqueBy,
  });
}

/**
 * Validate and freeze a host allowlist. Nothing in schema `api` is published
 * unless it appears here. Throws on misconfiguration so a host fails closed.
 */
export function defineDataApi(config: DataApiConfig): DataApiRegistry {
  if (!config || !Array.isArray(config.resources)) {
    throw new Error("data API resources must be an array");
  }
  const resources = config.resources.map(defineResource);
  unique(
    resources.map((resource) => resource.name),
    "resource name",
  );
  const resourceByName = new Map<string, DefinedDataApiResource>(
    resources.map((resource) => [resource.name, resource]),
  );
  return Object.freeze({
    resources: Object.freeze(resources),
    resourceByName,
  });
}

export function getResource(registry: DataApiRegistry, name: unknown): DefinedDataApiResource {
  const resourceName = assertResourceName(name);
  const resource = registry.resourceByName.get(resourceName);
  if (!resource) {
    throw new DataApiError({
      status: 404,
      code: "unknown_resource",
      message: "Resource is not available",
    });
  }
  return resource;
}
