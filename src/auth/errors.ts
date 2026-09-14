/**
 * Thrown by `requireUser` when there is no verified session.
 * Message and `status` match the Grok `UnauthorizedError` contract so clients
 * can send the visitor to sign-in on `err.message === "Unauthorized"`.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export function isUnauthorizedError(error: unknown): error is UnauthorizedError {
  return error instanceof UnauthorizedError ||
    (error instanceof Error &&
      error.name === "UnauthorizedError" &&
      error.message === "Unauthorized");
}

export type ForbiddenCode = "forbidden" | "not_allowed";

/**
 * Authenticated but not permitted. `not_allowed` is the allowlist denial.
 */
export class ForbiddenError extends Error {
  readonly status = 403;
  readonly code: ForbiddenCode;

  constructor(code: ForbiddenCode = "forbidden") {
    super("Forbidden");
    this.name = "ForbiddenError";
    this.code = code;
  }
}

export function isForbiddenError(error: unknown): error is ForbiddenError {
  return (
    error instanceof ForbiddenError ||
    (error instanceof Error &&
      error.name === "ForbiddenError" &&
      (error as ForbiddenError).status === 403)
  );
}

export class BadRequestError extends Error {
  readonly status = 400;
  readonly code = "bad_request";
  constructor(message = "Bad Request") {
    super(message);
    this.name = "BadRequestError";
  }
}

export function isBadRequestError(error: unknown): error is BadRequestError {
  return error instanceof BadRequestError || (error instanceof Error && error.name === "BadRequestError");
}

export class MethodNotAllowedError extends Error {
  readonly status = 405;
  readonly allow: string;
  constructor(allow: string) {
    super("Method Not Allowed");
    this.name = "MethodNotAllowedError";
    this.allow = allow;
  }
}

export function isMethodNotAllowedError(error: unknown): error is MethodNotAllowedError {
  return (
    error instanceof MethodNotAllowedError ||
    (error instanceof Error && error.name === "MethodNotAllowedError")
  );
}
