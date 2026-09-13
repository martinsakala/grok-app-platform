import { UnauthorizedError } from "./errors.js";
import { toAuthSession, toAuthUser } from "./identity.js";
import type { AuthSession, AuthSessionLookup, AuthSessionSource, AuthUser } from "./types.js";

function sessionUserFromUnknown(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object" && raw !== null && "user" in raw) {
    return (raw as { user: unknown }).user;
  }
  return raw;
}

/**
 * Bind a host-provided Better Auth / Grok session lookup to the platform
 * `AuthSessionSource`. The host must not parse identity itself — it only
 * forwards the session blob.
 */
export function createAuthSessionSource(lookup: AuthSessionLookup): AuthSessionSource {
  if (!lookup.getSession && !lookup.getSessionUser) {
    throw new Error("AuthSessionSource requires getSession or getSessionUser");
  }
  return {
    async getSessionUser() {
      if (lookup.getSessionUser) return lookup.getSessionUser();
      return sessionUserFromUnknown(await lookup.getSession?.());
    },
    async getSession() {
      if (lookup.getSession) return lookup.getSession();
      const user = await lookup.getSessionUser?.();
      return user ? { user } : null;
    },
  };
}

/**
 * Current verified user, or null when signed out / no session.
 * Does not accept a client-supplied user id — identity comes only from `source`.
 */
export async function getCurrentUser(source: AuthSessionSource): Promise<AuthUser | null> {
  return toAuthUser(await source.getSessionUser());
}

/**
 * Current verified session, or null when signed out.
 * The session token is never returned.
 */
export async function getCurrentSession(
  source: AuthSessionSource,
): Promise<AuthSession | null> {
  const fromSession = toAuthSession(await source.getSession());
  if (fromSession) return fromSession;
  const user = await getCurrentUser(source);
  return user ? { user, expiresAt: null } : null;
}

/**
 * Verified user, or a 401 `UnauthorizedError` when there is no session.
 * Client-supplied user ids are not a parameter and cannot be used here.
 */
export async function requireUser(source: AuthSessionSource): Promise<AuthUser> {
  const user = await getCurrentUser(source);
  if (!user) throw new UnauthorizedError();
  return user;
}
