"use client";

import { useEffect, useState } from "react";
import { roleCovers } from "../auth/roles.js";
import type { PlatformClient } from "./client.js";
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from "./states.js";
import type { AccessPolicy, MeResponse } from "./types.js";

export type AccessPolicyPreview =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "forbidden" }
  | { status: "data"; me: MeResponse; policy: AccessPolicy };

export function AccessPolicyPage({
  client,
  preview,
}: {
  client: PlatformClient;
  preview?: AccessPolicyPreview;
}) {
  const [view, setView] = useState<AccessPolicyPreview>(preview ?? { status: "loading" });

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await client.me();
        if (!roleCovers(me.roles, "owner")) {
          if (!cancelled) setView({ status: "forbidden" });
          return;
        }
        const policy = await client.getAccessPolicy();
        if (!cancelled) setView({ status: "data", me, policy });
      } catch (error) {
        if (!cancelled) setView({ status: "error", error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, preview]);

  if (view.status === "loading") return <LoadingState label="Loading access policy" />;
  if (view.status === "error") return <ErrorState error={view.error} />;
  if (view.status === "forbidden") return <ForbiddenState>Owner role required.</ForbiddenState>;
  if (!view.policy) return <EmptyState title="No policy" />;

  return <PolicyForm policy={view.policy} onSave={(next) => void client.setAccessPolicy(next)} />;
}

function PolicyForm({
  policy,
  onSave,
}: {
  policy: AccessPolicy;
  onSave: (input: { mode: "open" | "allowlist"; allowed_domains: string[]; allowed_emails: string[] }) => void;
}) {
  const [mode, setMode] = useState<"open" | "allowlist">(policy.mode);
  const [domains, setDomains] = useState(policy.allowedDomains.join("\n"));
  const [emails, setEmails] = useState(policy.allowedEmails.join("\n"));
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          mode,
          allowed_domains: splitLines(domains),
          allowed_emails: splitLines(emails),
        });
      }}
    >
      <h1 className="text-xl font-semibold text-[var(--pf-fg)]">Access policy</h1>
      <label className="block text-sm text-[var(--pf-muted)]">
        Mode
        <select
          className="mt-1 block w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 text-[var(--pf-fg)]"
          value={mode}
          onChange={(event) => setMode(event.target.value === "allowlist" ? "allowlist" : "open")}
        >
          <option value="open">open</option>
          <option value="allowlist">allowlist</option>
        </select>
      </label>
      <label className="block text-sm text-[var(--pf-muted)]">
        Allowed domains (one per line)
        <textarea
          className="mt-1 block h-24 w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 text-[var(--pf-fg)]"
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
        />
      </label>
      <label className="block text-sm text-[var(--pf-muted)]">
        Allowed emails (one per line)
        <textarea
          className="mt-1 block h-24 w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 text-[var(--pf-fg)]"
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
        />
      </label>
      <button
        type="submit"
        className="rounded-[var(--pf-radius)] border border-[var(--pf-accent)] px-4 py-2 text-sm text-[var(--pf-accent)]"
      >
        Save policy
      </button>
    </form>
  );
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
