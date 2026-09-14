/**
 * Client-safe data API failure. Never put SQL, schema names, connection
 * strings, or driver messages in `message`.
 */
export class DataApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(options: { status: number; code: string; message: string }) {
    super(options.message);
    this.name = "DataApiError";
    this.status = options.status;
    this.code = options.code;
  }
}

export function isDataApiError(error: unknown): error is DataApiError {
  return (
    error instanceof DataApiError ||
    (error instanceof Error &&
      error.name === "DataApiError" &&
      typeof (error as DataApiError).status === "number" &&
      typeof (error as DataApiError).code === "string")
  );
}
