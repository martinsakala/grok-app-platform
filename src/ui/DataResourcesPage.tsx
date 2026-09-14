"use client";

import { useEffect, useState } from "react";
import { roleCovers } from "../auth/roles.js";
import type { PlatformClient } from "./client.js";
import { isPlatformClientError } from "./errors.js";
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from "./states.js";
import type { ListedDataResource, ListResourceResult, MeResponse } from "./types.js";

export type DataResourcesPreview =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "forbidden" }
  | { status: "data"; me: MeResponse; resources: ListedDataResource[] };

export function DataResourcesPage({
  client,
  preview,
}: {
  client: PlatformClient;
  preview?: DataResourcesPreview;
}) {
  const [view, setView] = useState<DataResourcesPreview>(preview ?? { status: "loading" });

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await client.me();
        if (!roleCovers(me.roles, "member")) {
          if (!cancelled) setView({ status: "forbidden" });
          return;
        }
        const { resources } = await client.listDataResources();
        if (!cancelled) setView({ status: "data", me, resources });
      } catch (error) {
        if (!cancelled) setView({ status: "error", error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, preview]);

  if (view.status === "loading") return <LoadingState label="Loading data" />;
  if (view.status === "error") return <ErrorState error={view.error} />;
  if (view.status === "forbidden") return <ForbiddenState>Member role required.</ForbiddenState>;

  return (
    <div className="space-y-6" data-data-resources-page="true">
      <h1 className="text-xl font-semibold text-[var(--pf-fg)]">Data</h1>
      <p className="text-sm text-[var(--pf-muted)]">
        Owner-scoped reads. Export uses the same filter as the list API.
      </p>
      {view.resources.length === 0 ? (
        <EmptyState title="No resources" body="The host has not registered any data API resources." />
      ) : (
        <ul className="space-y-4">
          {view.resources.map((resource) => (
            <li key={resource.name}>
              <ResourceCard client={client} resource={resource} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResourceCard({
  client,
  resource,
}: {
  client: PlatformClient;
  resource: ListedDataResource;
}) {
  const [page, setPage] = useState<ListResourceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void client
      .listData(resource.name, { limit: 20 })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setError(failure instanceof Error ? failure.message : "Preview failed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, resource.name]);

  async function onExport(format: "csv" | "json") {
    setBusy(format);
    setError(null);
    try {
      const response = await client.exportData(resource.name, { format });
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const header = response.headers.get("content-disposition");
      const match = header?.match(/filename="([^"]+)"/);
      link.href = href;
      link.download = match?.[1] ?? `${resource.name}.${format === "csv" ? "csv" : "ndjson"}`;
      link.click();
      URL.revokeObjectURL(href);
    } catch (failure) {
      setError(
        isPlatformClientError(failure)
          ? failure.message
          : failure instanceof Error
            ? failure.message
            : "Export failed",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      className="space-y-3 rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)] p-4"
      data-data-resource={resource.name}
    >
      <header>
        <h2 className="font-mono text-sm text-[var(--pf-fg)]">{resource.name}</h2>
        <p className="mt-1 text-xs text-[var(--pf-muted)]">
          order by {resource.orderBy} · {resource.columns.join(", ")}
        </p>
      </header>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-[var(--pf-radius)] bg-[var(--pf-accent)] px-3 py-2 text-sm text-[var(--pf-accent-fg)] disabled:opacity-60"
          disabled={busy !== null}
          onClick={() => void onExport("csv")}
        >
          {busy === "csv" ? "Exporting…" : "Export CSV"}
        </button>
        <button
          type="button"
          className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] px-3 py-2 text-sm text-[var(--pf-fg)] disabled:opacity-60"
          disabled={busy !== null}
          onClick={() => void onExport("json")}
        >
          {busy === "json" ? "Exporting…" : "Export NDJSON"}
        </button>
      </div>
      {error ? (
        <p className="text-sm text-[var(--pf-danger)]" role="alert">
          {error}
        </p>
      ) : null}
      {page ? (
        <div className="overflow-x-auto">
          {page.items.length === 0 ? (
            <p className="text-sm text-[var(--pf-muted)]">No rows.</p>
          ) : (
            <table className="min-w-full text-left text-xs text-[var(--pf-fg)]">
              <thead>
                <tr>
                  {resource.columns.map((column) => (
                    <th key={column} className="border-b border-[var(--pf-border)] px-2 py-1 font-mono">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.items.map((item, index) => (
                  <tr key={index}>
                    {resource.columns.map((column) => (
                      <td key={column} className="border-b border-[var(--pf-border)] px-2 py-1 font-mono">
                        {formatCell(item[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </article>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
