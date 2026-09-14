import type { MutationInputErrorItem } from "./types.js";

export class MutationInputError extends Error {
  readonly status = 400;
  readonly code = "invalid_input";
  readonly errors: MutationInputErrorItem[];

  constructor(errors: MutationInputErrorItem[], message = "Invalid input") {
    super(message);
    this.name = "MutationInputError";
    this.errors = errors;
  }
}

export function isMutationInputError(error: unknown): error is MutationInputError {
  return (
    error instanceof MutationInputError ||
    (error instanceof Error &&
      error.name === "MutationInputError" &&
      Array.isArray((error as MutationInputError).errors))
  );
}

export class MutationError extends Error {
  readonly status = 409;
  readonly code: "conflict" | "idempotency_mismatch";

  constructor(code: "conflict" | "idempotency_mismatch", message?: string) {
    super(
      message ??
        (code === "idempotency_mismatch"
          ? "Idempotency key reused with a different input"
          : "Conflict"),
    );
    this.name = "MutationError";
    this.code = code;
  }
}

export function isMutationError(error: unknown): error is MutationError {
  return (
    error instanceof MutationError ||
    (error instanceof Error && error.name === "MutationError")
  );
}

export class UnknownMutationError extends Error {
  readonly status = 404;
  readonly code = "unknown_mutation";

  constructor() {
    super("Mutation is not available");
    this.name = "UnknownMutationError";
  }
}

export function isUnknownMutationError(error: unknown): error is UnknownMutationError {
  return (
    error instanceof UnknownMutationError ||
    (error instanceof Error && error.name === "UnknownMutationError")
  );
}

export class MutationFailedError extends Error {
  readonly status = 500;
  readonly code = "mutation_failed";

  constructor() {
    super("Mutation failed");
    this.name = "MutationFailedError";
  }
}

export function isMutationFailedError(error: unknown): error is MutationFailedError {
  return (
    error instanceof MutationFailedError ||
    (error instanceof Error && error.name === "MutationFailedError")
  );
}
