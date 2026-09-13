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
