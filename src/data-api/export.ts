import { UnauthorizedError } from "../auth/errors.js";
import { asAuthUser } from "../auth/principal.js";
import type { Database } from "../database/types.js";
import { createLogger, logError } from "../logging/index.js";
import { DataApiError, isDataApiError } from "./errors.js";
import {
  csvHeader,
  csvRow,
  exportContentType,
  exportFilename,
  ndjsonRow,
  type ExportFormat,
} from "./format.js";
import { qualifyApiRelation, quoteIdent } from "./identifiers.js";
import { listResource } from "./list.js";
import { getResource } from "./registry.js";
import type { DataApiRegistry } from "./types.js";
import { MAX_PAGE_SIZE } from "./types.js";

const logger = createLogger("data-api-export");

export const DEFAULT_EXPORT_MAX_ROWS = 100_000;

export type ExportResourceInput = {
  resource: unknown;
  user: Parameters<typeof asAuthUser>[0] | null | undefined;
  format: unknown;
  limit?: unknown;
};

export type ExportStreamResult = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  filename: string;
  truncated: boolean;
  rows: number;
  format: ExportFormat;
  resource: string;
};

function parseFormat(value: unknown): ExportFormat {
  if (value === "csv" || value === "json") return value;
  throw new DataApiError({
    status: 400,
    code: "invalid_input",
    message: "Invalid export format",
  });
}

function parseCap(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  let raw: number;
  if (typeof value === "number") raw = value;
  else if (typeof value === "string" && /^[0-9]+$/.test(value)) raw = Number.parseInt(value, 10);
  else {
    throw new DataApiError({
      status: 400,
      code: "invalid_input",
      message: "Invalid export limit",
    });
  }
  if (!Number.isInteger(raw) || raw < 1) {
    throw new DataApiError({
      status: 400,
      code: "invalid_input",
      message: "Invalid export limit",
    });
  }
  return raw;
}

/** Handler default, then setting may only lower it. */
export function resolveExportMaxRows(handlerMax: unknown, settingValue: unknown): number {
  const base =
    typeof handlerMax === "number" && Number.isInteger(handlerMax) && handlerMax > 0
      ? handlerMax
      : DEFAULT_EXPORT_MAX_ROWS;
  let setting: number | undefined;
  if (typeof settingValue === "number" && Number.isInteger(settingValue) && settingValue > 0) {
    setting = settingValue;
  } else if (typeof settingValue === "string" && /^[0-9]+$/.test(settingValue)) {
    const n = Number.parseInt(settingValue, 10);
    if (n > 0) setting = n;
  }
  if (setting === undefined) return base;
  return Math.min(base, setting);
}

async function countOwnedRows(
  db: Database,
  registry: DataApiRegistry,
  resourceName: unknown,
  ownerId: string,
): Promise<number> {
  const resource = getResource(registry, resourceName);
  const from = qualifyApiRelation(resource.relation);
  const owner = quoteIdent(resource.ownerColumn);
  try {
    const result = await db.query<{ n: unknown }>(
      `select count(*)::int as n from ${from} where ${owner} = $1`,
      [ownerId],
    );
    const n = result.rows[0]?.n;
    if (typeof n === "bigint") return Number(n);
    if (typeof n === "number") return n;
    return Number(n ?? 0);
  } catch (error) {
    if (isDataApiError(error) || error instanceof UnauthorizedError) throw error;
    throw new DataApiError({
      status: 500,
      code: "query_failed",
      message: "Resource query failed",
    });
  }
}

function encodeLine(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Stream an owner-scoped export. Pages internally with the list keyset
 * (`MAX_PAGE_SIZE`). `truncated` is known before the first byte so the HTTP
 * layer can set `X-Export-Truncated` on the response.
 */
export async function exportResource(
  registry: DataApiRegistry,
  db: Database,
  input: ExportResourceInput,
  options: { maxRows: number },
): Promise<ExportStreamResult> {
  const format = parseFormat(input.format);
  if (!input.user) throw new UnauthorizedError();
  const ownerId = asAuthUser(input.user).id;
  if (typeof ownerId !== "string" || ownerId.trim() === "") throw new UnauthorizedError();

  const resource = getResource(registry, input.resource);
  const maxRows = options.maxRows > 0 ? options.maxRows : DEFAULT_EXPORT_MAX_ROWS;
  const requested = parseCap(input.limit, maxRows);
  const cap = Math.min(requested, maxRows);
  const total = await countOwnedRows(db, registry, resource.name, ownerId);
  const rows = Math.min(total, cap);
  const truncated = total > cap;
  const filename = exportFilename(resource.name, format);
  const contentType = exportContentType(format);
  const columns = resource.columns;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (format === "csv") {
          controller.enqueue(encodeLine(`${csvHeader(columns)}\n`));
        }
        let cursor: string | undefined;
        let sent = 0;
        while (sent < rows) {
          const pageSize = Math.min(MAX_PAGE_SIZE, rows - sent);
          const page = await listResource(registry, db, {
            resource: resource.name,
            user: input.user,
            limit: pageSize,
            cursor,
          });
          for (const item of page.items) {
            const line = format === "csv" ? csvRow(columns, item) : ndjsonRow(item);
            controller.enqueue(encodeLine(`${line}\n`));
            sent += 1;
            if (sent >= rows) break;
          }
          if (!page.nextCursor || page.items.length === 0) break;
          cursor = page.nextCursor;
        }
        controller.close();
      } catch (error) {
        logError(logger, error, "export stream failed");
        try {
          controller.error(new Error("Export failed"));
        } catch {
          // already closed
        }
      }
    },
  });

  return {
    body,
    contentType,
    filename,
    truncated,
    rows,
    format,
    resource: resource.name,
  };
}
