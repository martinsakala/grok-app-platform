export type {
  AuthScheme,
  Capability,
  CapabilityKind,
  JsonSchema,
  OpenApiDocument,
  PlatformRegistry,
} from "./types.js";
export { CAPABILITY_KINDS } from "./types.js";
export { APP_CONTRACT_VERSION, buildRegistry, type BuildRegistryInput } from "./build.js";
export { buildOpenApi, assertOpenApiShape } from "./openapi.js";
export { buildLlmsTxt } from "./llms.js";
export { etagFor, ifNoneMatch } from "./etag.js";
export {
  assertRegistryCoversRoutes,
  capabilityCoversRoute,
  handlerPatternFromCapabilityPath,
  type HttpRouteRef,
} from "./coverage.js";
export { fieldToJsonSchema, mutationInputToJsonSchema, ERROR_SCHEMA } from "./json-schema.js";
