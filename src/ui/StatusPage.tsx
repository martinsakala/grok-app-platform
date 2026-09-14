"use client";

import { useEffect, useState } from "react";
import { PLATFORM_VERSION } from "../runtime/generated/platform-version.js";
import { roleCovers } from "../auth/roles.js";
import type { PlatformClient } from "./client.js";
import { PlatformClientError } from "./errors.js";
import { EmptyState, ErrorState, LoadingState } from "./states.js";
import type { HealthPayload, MeResponse, VersionResponse } from "./types.js";

export type StatusPreview =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "data"; health: HealthPayload; version: VersionResponse; me: MeResponse | null };

export function StatusPage({
  client,
  preview,
}: {
  client: PlatformClient;
  preview?: StatusPreview;
}) {
  const [view, setView] = useState<StatusPreview>(preview ?? { status: "loading" });

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    Promise.all([client.health(), client.version(), client.me().catch((error: unknown) => error)])
      .then(([health, version, meOrError]) => {
        if (cancelled) return;
        const me =
          meOrError && typeof meOrError === "object" && "kind" in meOrError
            ? (meOrError as MeResponse)
            : meOrError instanceof PlatformClientError && meOrError.status === 401
              ? null
              : null;
        if (meOrError instanceof Error && !(meOrError instanceof PlatformClientError && meOrError.status === 401)) {
          setView({ status: "error", error: meOrError });
          return;
        }
        setView({ status: "data", health, version, me });
      })
      .catch((error: unknown) => {
        if (!cancelled) setView({ status: "error", error });
      });
    return () => {
      cancelled = true;
    };
  }, [client, preview]);

  if (view.status === "loading") return <LoadingState label="Loading status" />;
  if (view.status === "error") return <ErrorState error={view.error} />;

  const { health, version, me } = view;
  const versionOk = version.platformVersion === PLATFORM_VERSION;
  const meLabel = me
    ? me.kind === "user"
      ? me.user.email || me.user.id
      : me.keyName
    : "Signed out";
  const roles = me?.roles ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-[var(--pf-fg)]">Status</h1>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Item label="Health" value={health.status} ok={health.status === "ok"} />
        <Item
          label="Database"
          value={`${health.database.status} / ${health.database.engine}`}
          ok={health.database.status === "ok"}
        />
        <Item label="Application" value={version.application} ok />
        <Item
          label="Platform"
          value={`${version.platformVersion}${versionOk ? "" : ` (expected ${PLATFORM_VERSION})`}`}
          ok={versionOk}
        />
        <Item label="Identity" value={meLabel} ok={me !== null} />
        <Item
          label="Roles"
          value={roles.length ? roles.join(", ") : "—"}
          ok={me !== null && roleCovers(roles, "member")}
        />
      </dl>
      {!me ? <EmptyState title="Not signed in" body="Health and version are public. Sign in to see your principal." /> : null}
    </div>
  );
}

function Item({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)] p-4">
      <dt className="text-xs uppercase tracking-wide text-[var(--pf-muted)]">{label}</dt>
      <dd className={`mt-1 text-sm ${ok ? "text-[var(--pf-fg)]" : "text-[var(--pf-danger)]"}`}>{value}</dd>
    </div>
  );
}
