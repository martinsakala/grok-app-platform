export type {
  AuthDiagnostics,
  AuthSession,
  AuthSessionLookup,
  AuthSessionSource,
  AuthUser,
} from "./types.js";

export { UnauthorizedError, isUnauthorizedError } from "./errors.js";
export {
  assignOwner,
  assertNoSecrets,
  authUserKeys,
  ownerIdFromSession,
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
