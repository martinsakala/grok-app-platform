"use client";

import { useEffect, useState } from "react";
import type { Role } from "../auth/roles.js";
import type { PlatformClient } from "./client.js";
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from "./states.js";
import type { ApiKeyView, CreatedApiKey, MeResponse } from "./types.js";

export type ApiKeysPreview =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "forbidden" }
  | { status: "data"; me: MeResponse; keys: ApiKeyView[]; created?: CreatedApiKey | null };

export function ApiKeysPage({
  client,
  preview,
}: {
  client: PlatformClient;
  preview?: ApiKeysPreview;
}) {
  const [view, setView] = useState<ApiKeysPreview>(preview ?? { status: "loading" });

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await client.me();
        const { keys } = await client.listApiKeys();
        if (!cancelled) setView({ status: "data", me, keys, created: null });
      } catch (error) {
        if (!cancelled) setView({ status: "error", error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, preview]);

  if (view.status === "loading") return <LoadingState label="Loading API keys" />;
  if (view.status === "error") {
    const forbidden =
      view.error &&
      typeof view.error === "object" &&
      "status" in view.error &&
      (view.error as { status?: number }).status === 403;
    if (forbidden) return <ForbiddenState>You cannot manage API keys.</ForbiddenState>;
    return <ErrorState error={view.error} />;
  }
  if (view.status === "forbidden") return <ForbiddenState>You cannot manage API keys.</ForbiddenState>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[var(--pf-fg)]">API keys</h1>
      <CreateKeyForm
        defaultRoles={view.me.roles[0] ? [view.me.roles.includes("member") ? "member" : view.me.roles[0]] : ["member"]}
        onCreate={async (input) => {
          const created = await client.createApiKey(input);
          const { keys } = await client.listApiKeys();
          setView({ status: "data", me: view.me, keys, created });
        }}
      />
      {view.created?.key ? (
        <div className="rounded-[var(--pf-radius)] border border-[var(--pf-accent)] bg-[var(--pf-surface)] p-4 text-sm">
          <p className="font-medium text-[var(--pf-fg)]">Copy this key now. It is shown once.</p>
          <p className="mt-2 break-all font-mono text-[var(--pf-accent)]">{view.created.key}</p>
        </div>
      ) : null}
      {view.keys.length === 0 ? (
        <EmptyState title="No API keys" body="Create a key to call the platform without a browser session." />
      ) : (
        <ul className="space-y-3">
          {view.keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)] p-4"
            >
              <div>
                <p className="text-sm font-medium text-[var(--pf-fg)]">{key.name}</p>
                <p className="text-xs text-[var(--pf-muted)]">
                  {key.prefix}… · {key.roles.join(", ")}
                  {key.revokedAt ? " · revoked" : ""}
                </p>
              </div>
              {key.revokedAt ? null : (
                <button
                  type="button"
                  className="text-xs text-[var(--pf-danger)]"
                  onClick={() => void client.revokeApiKey(key.id)}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateKeyForm({
  defaultRoles,
  onCreate,
}: {
  defaultRoles: Role[];
  onCreate: (input: { name: string; roles: Role[] }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [rolesText, setRolesText] = useState(defaultRoles.join(","));
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        const roles = rolesText
          .split(",")
          .map((item) => item.trim())
          .filter((item): item is Role => item === "owner" || item === "admin" || item === "member");
        void onCreate({ name: name.trim(), roles: roles.length ? roles : ["member"] });
      }}
    >
      <label className="block flex-1 text-sm text-[var(--pf-muted)]">
        Name
        <input
          className="mt-1 block w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 text-[var(--pf-fg)]"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="block text-sm text-[var(--pf-muted)]">
        Roles
        <input
          className="mt-1 block w-40 rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 text-[var(--pf-fg)]"
          value={rolesText}
          onChange={(event) => setRolesText(event.target.value)}
        />
      </label>
      <button
        type="submit"
        className="rounded-[var(--pf-radius)] border border-[var(--pf-accent)] px-4 py-2 text-sm text-[var(--pf-accent)]"
      >
        Create key
      </button>
    </form>
  );
}
