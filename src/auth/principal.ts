import { lookupApiKey } from "../api-keys/lookup.js";
import { ensureUserRoles } from "../access/bootstrap.js";
import { ForbiddenError, UnauthorizedError } from "./errors.js";
import { roleCovers, type Role } from "./roles.js";
import { getCurrentUser } from "./session.js";
import type { AuthSessionSource, AuthUser } from "./types.js";

export type UserPrincipal = {
  kind: "user";
  user: AuthUser;
  roles: Role[];
};

export type ApiKeyPrincipal = {
  kind: "api-key";
  keyId: string;
  name: string;
  ownerUserId: string;
  roles: Role[];
};

export type Principal = UserPrincipal | ApiKeyPrincipal;

export function isPrincipal(value: unknown): value is Principal {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "user" || kind === "api-key";
}

export function ownerIdOf(identity: Principal | AuthUser): string {
  if (isPrincipal(identity)) {
    return identity.kind === "user" ? identity.user.id : identity.ownerUserId;
  }
  return identity.id;
}

export function asAuthUser(identity: Principal | AuthUser): AuthUser {
  if (isPrincipal(identity)) {
    if (identity.kind === "user") return identity.user;
    return {
      id: identity.ownerUserId,
      email: "",
      name: identity.name,
      image: null,
    };
  }
  return identity;
}

export function hasRole(principal: Principal, role: Role): boolean {
  return roleCovers(principal.roles, role);
}

export function requireRole(principal: Principal, role: Role): void {
  if (!hasRole(principal, role)) throw new ForbiddenError("forbidden");
}

function bearerToken(request: Request | undefined): string | null {
  if (!request) return null;
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)/i);
  return match?.[1] ?? null;
}

/**
 * Resolve a principal from an API key (`gk_…`) or a verified session.
 * Client `user_id` is never consulted. Missing identity → 401.
 * `appConfig.ownerEmails` is passed into role bootstrap.
 */
export async function requirePrincipal(
  source: AuthSessionSource,
  request?: Request,
  appConfig?: { ownerEmails?: readonly string[] },
): Promise<Principal> {
  const token = bearerToken(request);
  if (token && token.startsWith("gk_")) {
    const fromKey = await lookupApiKey(token);
    if (!fromKey) throw new UnauthorizedError();
    return fromKey;
  }
  const user = await getCurrentUser(source);
  if (!user) throw new UnauthorizedError();
  const roles = await ensureUserRoles(user, appConfig?.ownerEmails ?? []);
  return { kind: "user", user, roles };
}