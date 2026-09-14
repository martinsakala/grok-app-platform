"use client";

import { useEffect, useState } from "react";
import { roleCovers } from "../auth/roles.js";
import type { PlatformClient } from "./client.js";
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from "./states.js";
import type { MeResponse, SettingRecord } from "./types.js";

function isPlatformSettingKey(key: string): boolean {
  return key === "platform" || key.startsWith("platform.");
}

export type SettingsPreview =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "forbidden" }
  | { status: "data"; me: MeResponse; settings: SettingRecord[] };

export function SettingsPage({
  client,
  preview,
}: {
  client: PlatformClient;
  preview?: SettingsPreview;
}) {
  const [view, setView] = useState<SettingsPreview>(preview ?? { status: "loading" });

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
        const { settings } = await client.listSettings();
        if (!cancelled) setView({ status: "data", me, settings });
      } catch (error) {
        if (!cancelled) setView({ status: "error", error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, preview]);

  if (view.status === "loading") return <LoadingState label="Loading settings" />;
  if (view.status === "error") return <ErrorState error={view.error} />;
  if (view.status === "forbidden") return <ForbiddenState>Member role required.</ForbiddenState>;

  const canWriteAdmin = roleCovers(view.me.roles, "admin");
  const canWriteOwner = roleCovers(view.me.roles, "owner");

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[var(--pf-fg)]">Settings</h1>
      {canWriteAdmin ? (
        <NewSettingForm
          canWriteOwner={canWriteOwner}
          onCreate={(key, value) => void client.setSetting(key, value)}
        />
      ) : null}
      {view.settings.length === 0 ? (
        <EmptyState title="No settings" body="JSON documents appear here after an admin writes one." />
      ) : (
        <ul className="space-y-3">
          {view.settings.map((setting) => (
            <SettingRow
              key={setting.key}
              setting={setting}
              canWrite={isPlatformSettingKey(setting.key) ? canWriteOwner : canWriteAdmin}
              onSave={(value) => void client.setSetting(setting.key, value)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SettingRow({
  setting,
  canWrite,
  onSave,
}: {
  setting: SettingRecord;
  canWrite: boolean;
  onSave: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(setting.value, null, 2));
  const [invalid, setInvalid] = useState(false);
  return (
    <li className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)] p-4">
      <p className="font-mono text-sm text-[var(--pf-fg)]">{setting.key}</p>
      <textarea
        className="mt-2 h-28 w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 font-mono text-xs text-[var(--pf-fg)]"
        value={text}
        disabled={!canWrite}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
      />
      {invalid ? <p className="mt-1 text-xs text-[var(--pf-danger)]">Invalid JSON</p> : null}
      {canWrite ? (
        <button
          type="button"
          className="mt-2 text-xs text-[var(--pf-accent)]"
          onClick={() => {
            try {
              onSave(JSON.parse(text) as unknown);
            } catch {
              setInvalid(true);
            }
          }}
        >
          Save JSON
        </button>
      ) : (
        <p className="mt-2 text-xs text-[var(--pf-muted)]">Read-only</p>
      )}
    </li>
  );
}

function NewSettingForm({
  canWriteOwner,
  onCreate,
}: {
  canWriteOwner: boolean;
  onCreate: (key: string, value: unknown) => void;
}) {
  const [key, setKey] = useState("");
  const [text, setText] = useState("{}");
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (key.startsWith("platform.") && !canWriteOwner) return;
        onCreate(key.trim(), JSON.parse(text) as unknown);
      }}
    >
      <label className="block text-sm text-[var(--pf-muted)]">
        New key
        <input
          className="mt-1 block w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 font-mono text-sm text-[var(--pf-fg)]"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <textarea
        className="h-20 w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 font-mono text-xs text-[var(--pf-fg)]"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="submit"
        className="rounded-[var(--pf-radius)] border border-[var(--pf-accent)] px-4 py-2 text-sm text-[var(--pf-accent)]"
      >
        Create setting
      </button>
    </form>
  );
}
