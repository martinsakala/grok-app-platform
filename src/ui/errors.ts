/**
 * Client-side HTTP error. Never includes secrets, tokens, hashes, or raw bodies.
 */
export class PlatformClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors?: { path: string; message: string }[];

  constructor(
    status: number,
    code: string,
    message: string,
    errors?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "PlatformClientError";
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export function isPlatformClientError(error: unknown): error is PlatformClientError {
  return error instanceof PlatformClientError;
}

export function defaultErrorCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 405) return "method_not_allowed";
  if (status === 400) return "bad_request";
  return "error";
}

export function defaultErrorMessage(status: number): string {
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  if (status === 404) return "Not Found";
  if (status === 405) return "Method Not Allowed";
  if (status === 400) return "Bad Request";
  return "Request failed";
}

/** Map a JSON error body. Only `error` and `code` are read. */
export function mapResponseError(status: number, body: unknown): PlatformClientError {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const message =
    typeof record.error === "string" && record.error.trim()
      ? record.error
      : defaultErrorMessage(status);
  const code =
    typeof record.code === "string" && record.code.trim()
      ? record.code
      : defaultErrorCode(status);
  let errors: { path: string; message: string }[] | undefined;
  if (Array.isArray(record.errors)) {
    const parsed = record.errors.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as { path?: unknown; message?: unknown };
      if (typeof item.path !== "string" || typeof item.message !== "string") return [];
      return [{ path: item.path, message: item.message }];
    });
    if (parsed.length) errors = parsed;
  }
  return new PlatformClientError(status, code, message, errors);
}
