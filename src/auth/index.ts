export type {
  AuthDiagnostics,
  AuthSession,
  AuthSessionLookup,
  AuthSessionSource,
  AuthUser,
} from "./types.js";

export {
  UnauthorizedError,
  isUnauthorizedError,
  ForbiddenError,
  isForbiddenError,
  BadRequestError,
  isBadRequestError,
  MethodNotAllowedError,
  isMethodNotAllowedError,
} from "./errors.js";
export type { ForbiddenCode } from "./errors.js";
export { ROLES, isRole, parseRoles, type Role } from "./roles.js";
export {
  requirePrincipal,
  requireRole,
  hasRole,
  ownerIdOf,
  asAuthUser,
  isPrincipal,
  type Principal,
  type UserPrincipal,
  type ApiKeyPrincipal,
} from "./principal.js";
export {
  assignOwner,
  assertNoSecrets,
  authUserKeys,
  ownerIdFromSession,
  SECRET_KEY_PATTERN,
  toAuthSession,
  toAuthUser,
} from "./identity.js";
export {
  createAuthSessionSource,
  getCurrentSession,
  getCurrentUser,
  requireUser,
} from "./session.js";
export {
  AUTH_RELATIONS_EXCLUDED_FROM_DATA_API,
  isExcludedFromDataApi,
} from "./exclusion.js";
export { getAuthDiagnostics } from "./diagnostics.js";
