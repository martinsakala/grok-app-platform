/**
 * Defense-in-depth denylist. The primary future data-API boundary is a
 * **positive allowlist over schema `api` only**. `public`, `private`, and
 * `app` must never be auto-published. These Better Auth relations sit in
 * `public` only because Grok/Better Auth require it.
 */
export const AUTH_RELATIONS_EXCLUDED_FROM_DATA_API = [
  'public."user"',
  'public."session"',
  'public."account"',
  'public."verification"',
] as const;

export type AuthExcludedRelation = (typeof AUTH_RELATIONS_EXCLUDED_FROM_DATA_API)[number];

export function isExcludedFromDataApi(qualifiedName: string): boolean {
  const normalized = qualifiedName.trim().toLowerCase().replace(/"/g, "");
  return AUTH_RELATIONS_EXCLUDED_FROM_DATA_API.some((entry) => {
    return entry.replace(/"/g, "").toLowerCase() === normalized;
  });
}
