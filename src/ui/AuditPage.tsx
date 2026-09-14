"use client";

import { useEffect, useState } from "react";
import { roleCovers } from "../auth/roles.js";
import type { PlatformClient } from "./client.js";
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from "./states.js";
import type { AuditEntry, MeResponse } from "./types.js";

export type AuditPreview =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "forbidden" }
  | { status: "data"; me: MeResponse; entries: AuditEntry[]; nextBefore: number | null; action?: string; entity?: string };

export function AuditPage({
  client,
  preview,
}: {
  client: PlatformClient;
  preview?: AuditPreview;
}) {
  const [view, setView] = useState<AuditPreview>(preview ?? { status: "loading" });
  const [action, setAction] = useState(preview && preview.status === "data" ? preview.action ?? "" : "");
  const [entity, setEntity] = useState(preview && preview.status === "data" ? preview.entity ?? "" : "");

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await client.me();
        if (!roleCovers(me.roles, "admin")) {
          if (!cancelled) setView({ status: "forbidden" });
          return;
        }
        const page = await client.listAudit({
          action: action || undefined,
          entity: entity || undefined,
        });
        if (!cancelled) setView({ status: "data", me, ...page, action, entity });
      } catch (error) {
        if (!cancelled) setView({ status: "error", error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, preview, action, entity]);

  if (view.status === "loading") return <LoadingState label="Loading audit log" />;
  if (view.status === "error") return <ErrorState error={view.error} />;
  if (view.status === "forbidden") return <ForbiddenState>Admin role required.</ForbiddenState>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[var(--pf-fg)]">Audit</h1>
      <form
        className="flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setAction(String(form.get("action") ?? ""));
          setEntity(String(form.get("entity") ?? ""));
        }}
      >
        <input
          name="action"
          defaultValue={action}
          placeholder="action"
          className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 text-sm text-[var(--pf-fg)]"
        />
        <input
          name="entity"
          defaultValue={entity}
          placeholder="entity"
          className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 text-sm text-[var(--pf-fg)]"
        />
        <button type="submit" className="text-sm text-[var(--pf-accent)]">
          Filter
        </button>
      </form>
      {view.entries.length === 0 ? (
        <EmptyState title="No audit entries" body="Role, policy, key and settings changes appear here." />
      ) : (
        <ol className="space-y-2">
          {view.entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)] p-3 text-sm"
            >
              <p className="text-[var(--pf-fg)]">
                {entry.action} · {entry.entity}
                {entry.entityId ? `/${entry.entityId}` : ""}
              </p>
              <p className="text-xs text-[var(--pf-muted)]">
                #{entry.id} · {entry.at} · {entry.principalLabel}
              </p>
            </li>
          ))}
        </ol>
      )}
      {view.nextBefore ? (
        <button
          type="button"
          className="text-sm text-[var(--pf-accent)]"
          onClick={() => {
            void client.listAudit({ before: view.nextBefore ?? undefined, action: action || undefined, entity: entity || undefined }).then((page) => {
              setView({
                status: "data",
                me: view.me,
                entries: [...view.entries, ...page.entries],
                nextBefore: page.nextBefore,
                action,
                entity,
              });
            });
          }}
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
