import { createHash, randomUUID } from "node:crypto";
import { audit } from "../audit/index.js";
import { ForbiddenError } from "../auth/errors.js";
import { ownerIdOf, type Principal } from "../auth/principal.js";
import { getInternalDatabase } from "../database/client.js";
import { createLogger, logError } from "../logging/index.js";
import {
  MutationError,
  MutationFailedError,
  MutationInputError,
  UnknownMutationError,
  isMutationError,
  isMutationInputError,
} from "./errors.js";
import { canRunMutation, getMutation } from "./registry.js";
import type { MutationOutcome, MutationRegistry } from "./types.js";
import { validateMutationInput } from "./validate.js";

const logger = createLogger("mutations");
const IDEMPOTENCY_MAX = 128;
const IDEMPOTENCY_TTL = "24 hours";

function principalIdOf(principal: Principal): string {
  return principal.kind === "user" ? principal.user.id : principal.keyId;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function hashMutationInput(input: unknown): string {
  return createHash("sha256").update(stableStringify(input ?? null)).digest("hex");
}

export function parseIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > IDEMPOTENCY_MAX) {
    throw new MutationInputError(
      [{ path: "Idempotency-Key", message: "Must be 1 to 128 characters" }],
      "Invalid idempotency key",
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new MutationInputError(
      [{ path: "Idempotency-Key", message: "Contains invalid characters" }],
      "Invalid idempotency key",
    );
  }
  return value;
}

export function resolveRequestId(header: string | null): string {
  if (header && /^[A-Za-z0-9._-]{1,128}$/.test(header)) return header;
  return randomUUID();
}

function jsonResult(value: unknown): unknown {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new MutationFailedError();
  }
  if (encoded === undefined) throw new MutationFailedError();
  try {
    return JSON.parse(encoded) as unknown;
  } catch {
    throw new MutationFailedError();
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505" || code === 23505) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate key|unique constraint|unique_violation/i.test(message);
}

async function recordAudit(
  principal: Principal,
  name: string,
  outcome: MutationOutcome,
  inputHash: string,
  requestId: string,
): Promise<void> {
  await audit(principal, {
    action: `mutation.${name}`,
    entity: "mutation",
    entityId: name,
    meta: {
      outcome,
      inputSha256: inputHash,
      requestId,
      principalKind: principal.kind,
      principalId: principalIdOf(principal),
    },
  });
}

function storedResult(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

async function sweepExpired(): Promise<void> {
  try {
    const db = await getInternalDatabase();
    await db.query(
      `delete from private.idempotency_keys where created_at < now() - ($1::interval)`,
      [IDEMPOTENCY_TTL],
    );
  } catch (error) {
    logError(logger, error, "idempotency sweep failed");
  }
}

export async function executeMutation(options: {
  registry: MutationRegistry;
  principal: Principal;
  name: unknown;
  input: unknown;
  idempotencyKey?: unknown;
  requestId: string;
}): Promise<unknown> {
  const name = typeof options.name === "string" ? options.name : "";
  const inputHash = hashMutationInput(options.input);
  const mutation = getMutation(options.registry, name);
  if (!mutation) {
    await recordAudit(options.principal, name || "unknown", "failed", inputHash, options.requestId);
    throw new UnknownMutationError();
  }
  if (!canRunMutation(options.principal, mutation)) {
    await recordAudit(options.principal, mutation.name, "forbidden", inputHash, options.requestId);
    throw new ForbiddenError("forbidden");
  }

  let validated: Record<string, unknown>;
  try {
    validated = validateMutationInput(mutation.input, options.input);
  } catch (error) {
    if (isMutationInputError(error)) {
      await recordAudit(options.principal, mutation.name, "invalid_input", inputHash, options.requestId);
    }
    throw error;
  }

  const idempotencyKey = parseIdempotencyKey(options.idempotencyKey);
  await sweepExpired();
  const db = await getInternalDatabase();
  const principalId = principalIdOf(options.principal);

  try {
    const outcome = await db.transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.query<{ request_hash: string; response: unknown }>(
          `select request_hash, response from private.idempotency_keys
           where principal_id = $1 and mutation = $2 and key = $3`,
          [principalId, mutation.name, idempotencyKey],
        );
        const row = existing.rows[0];
        if (row) {
          if (row.request_hash !== inputHash) {
            throw new MutationError("idempotency_mismatch");
          }
          return { replayed: true as const, result: storedResult(row.response) };
        }
        await tx.exec("SAVEPOINT grok_idem");
        try {
          await tx.query(
            `insert into private.idempotency_keys
               (principal_id, mutation, key, request_hash, response)
             values ($1, $2, $3, $4, null)`,
            [principalId, mutation.name, idempotencyKey, inputHash],
          );
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          await tx.exec("ROLLBACK TO SAVEPOINT grok_idem");
          const raced = await tx.query<{ request_hash: string; response: unknown }>(
            `select request_hash, response from private.idempotency_keys
             where principal_id = $1 and mutation = $2 and key = $3`,
            [principalId, mutation.name, idempotencyKey],
          );
          const racedRow = raced.rows[0];
          if (!racedRow) throw error;
          if (racedRow.request_hash !== inputHash) {
            throw new MutationError("idempotency_mismatch");
          }
          return { replayed: true as const, result: storedResult(racedRow.response) };
        }
      }

      let raw: unknown;
      try {
        raw = await mutation.handler({
          principal: options.principal,
          db: { query: (sql, params) => tx.query(sql, params) },
          input: validated,
          logger,
          request: { id: options.requestId },
        });
      } catch (error) {
        if (isMutationError(error) && error.code === "conflict") throw error;
        logError(logger, error, "mutation handler failed");
        throw new MutationFailedError();
      }

      const encoded = jsonResult(raw);
      if (idempotencyKey) {
        await tx.query(
          `update private.idempotency_keys
              set response = $4::jsonb
            where principal_id = $1 and mutation = $2 and key = $3`,
          [principalId, mutation.name, idempotencyKey, JSON.stringify(encoded)],
        );
      }
      return { replayed: false as const, result: encoded };
    });
    await recordAudit(
      options.principal,
      mutation.name,
      outcome.replayed ? "replayed" : "ok",
      inputHash,
      options.requestId,
    );
    return outcome.result;
  } catch (error) {
    if (isMutationError(error) && error.code === "idempotency_mismatch") {
      await recordAudit(options.principal, mutation.name, "conflict", inputHash, options.requestId);
      throw error;
    }
    if (isMutationError(error) && error.code === "conflict") {
      await recordAudit(options.principal, mutation.name, "conflict", inputHash, options.requestId);
      throw error;
    }
    if (error instanceof MutationFailedError) {
      await recordAudit(options.principal, mutation.name, "failed", inputHash, options.requestId);
      throw error;
    }
    logError(logger, error, "mutation failed");
    await recordAudit(options.principal, mutation.name, "failed", inputHash, options.requestId);
    throw new MutationFailedError();
  }
}

/** Owner of the data is the session user or the API-key owner — never a client field. */
export function mutationOwnerId(principal: Principal): string {
  return ownerIdOf(principal);
}
