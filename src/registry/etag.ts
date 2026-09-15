import { createHash } from "node:crypto";

export function etagFor(body: string): string {
  const digest = createHash("sha256").update(body).digest("hex").slice(0, 32);
  return `"${digest}"`;
}

export function ifNoneMatch(request: Request, etag: string): boolean {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === etag || part === `W/${etag}`);
}
