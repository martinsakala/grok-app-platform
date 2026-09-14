import { BadRequestError } from "../auth/errors.js";

const MAX_JSON_BYTES = 32 * 1024;

export async function readJsonBody(request: Request): Promise<unknown> {
  const headerLen = request.headers.get("content-length");
  if (headerLen && Number.parseInt(headerLen, 10) > MAX_JSON_BYTES) {
    throw new BadRequestError("Request body too large");
  }
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) {
    throw new BadRequestError("Request body too large");
  }
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadRequestError("Invalid JSON");
  }
}
