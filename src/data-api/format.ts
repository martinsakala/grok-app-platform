const INJECTION_PREFIX = /^[=+\-@]/;

export type ExportFormat = "csv" | "json";

/** RFC 4180 cell, LF records, no BOM. Null → empty. Formula prefix → apostrophe. */
export function stringifyExportValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "" : encoded;
  } catch {
    return "";
  }
}

export function guardCsvInjection(value: string): string {
  if (value.length > 0 && INJECTION_PREFIX.test(value)) return `'${value}`;
  return value;
}

export function csvCell(value: unknown): string {
  const guarded = guardCsvInjection(stringifyExportValue(value));
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replaceAll('"', '""')}"`;
  }
  return guarded;
}

export function csvRow(columns: readonly string[], row: Record<string, unknown>): string {
  return columns.map((column) => csvCell(row[column])).join(",");
}

export function csvHeader(columns: readonly string[]): string {
  return columns.map((column) => csvCell(column)).join(",");
}

export function ndjsonRow(row: Record<string, unknown>): string {
  return JSON.stringify(row, (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    return value;
  });
}

export function exportFilename(resource: string, format: ExportFormat, at = new Date()): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const ext = format === "csv" ? "csv" : "ndjson";
  return `${resource}-${stamp}.${ext}`;
}

export function exportContentType(format: ExportFormat): string {
  return format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson";
}
