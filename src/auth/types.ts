/**
 * Stable application-facing identity. Never includes Better Auth internals,
 * tokens, secrets, or password hashes.
 */
export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

/**
 * Stable session view. The raw session token is never included.
 */
export type AuthSession = {
  user: AuthUser;
  expiresAt: string | null;
};

/**
 * Injected session lookup. Downstream hosts bind this to Grok Better Auth
 * (`auth.api.getSession` / `getSessionUser`). The platform never talks to
 * Google or parses cookies itself.
 */
export type AuthSessionSource = {
  getSessionUser(): Promise<unknown>;
  getSession(): Promise<unknown>;
};

export type AuthSessionLookup = {
  getSessionUser?: () => Promise<unknown>;
  getSession?: () => Promise<unknown>;
};

/**
 * Safe diagnostics. No secrets, no provider credentials, no tokens, no
 * signed-in user. An unauthenticated visitor is not an error.
 */
export type AuthDiagnostics = {
  schemaReady: boolean;
};
