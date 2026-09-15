"use client";

import { useEffect, useMemo, useState } from "react";
import { roleCovers } from "../auth/roles.js";
import { CAPABILITY_KINDS, type CapabilityKind } from "../registry/types.js";
import type { PlatformClient } from "./client.js";
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from "./states.js";
import type { Capability, MeResponse, PlatformRegistry } from "./types.js";

const KIND_LABEL: Record<CapabilityKind, string> = {
  read: "Read",
  write: "Write",
  export: "Export",
  design: "Design",
  settings: "Settings",
  admin: "Admin",
  audit: "Audit",
};

export type ApiDocsPreview =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "forbidden" }
  | { status: "data"; me: MeResponse; registry: PlatformRegistry };

export function curlForCapability(capability: Capability): string {
  const headers = ['-H "Authorization: Bearer $API_KEY"'];
  const parts = ["curl", "-sS"];
  if (capability.method !== "GET") {
    parts.push("-X", capability.method);
  }
  parts.push(...headers);
  if (capability.method === "POST" || capability.method === "PUT") {
    parts.push('-H "Content-Type: application/json"');
    if (capability.method === "POST" && capability.kind === "write") {
      parts.push('-H "Idempotency-Key: unique-request-id"');
    }
    parts.push("-d", `'${sampleBody(capability)}'`);
  }
  let url = capability.path;
  if (capability.pagination === "cursor") {
    url += url.includes("?") ? "&limit=50&cursor=CURSOR" : "?limit=50&cursor=CURSOR";
  } else if (
    capability.kind === "export" &&
    capability.input &&
    typeof capability.input === "object" &&
    (capability.input.properties as { format?: unknown } | undefined)?.format
  ) {
    url += url.includes("?") ? "&format=csv" : "?format=csv";
  }
  parts.push(url);
  return parts.join(" ");
}

function sampleBody(capability: Capability): string {
  const input = capability.input;
  if (!input || typeof input !== "object") return "{}";
  const properties = (input.properties ?? {}) as Record<string, unknown>;
  const keys = Object.keys(properties);
  if (keys.length === 0) return "{}";
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, `…${key}`])));
}

export function ApiDocsPage({
  client,
  preview,
}: {
  client: PlatformClient;
  preview?: ApiDocsPreview;
}) {
  const [view, setView] = useState<ApiDocsPreview>(preview ?? { status: "loading" });

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
        const registry = await client.getRegistry();
        if (!cancelled) setView({ status: "data", me, registry });
      } catch (error) {
        if (!cancelled) setView({ status: "error", error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, preview]);

  if (view.status === "loading") return <LoadingState label="Loading API" />;
  if (view.status === "error") return <ErrorState error={view.error} />;
  if (view.status === "forbidden") return <ForbiddenState>Member role required.</ForbiddenState>;

  return <ApiDocsBody registry={view.registry} />;
}

function ApiDocsBody({ registry }: { registry: PlatformRegistry }) {
  const grouped = useMemo(() => {
    const map = new Map<CapabilityKind, Capability[]>();
    for (const kind of CAPABILITY_KINDS) map.set(kind, []);
    for (const capability of registry.capabilities) {
      const bucket = map.get(capability.kind) ?? [];
      bucket.push(capability);
      map.set(capability.kind, bucket);
    }
    return CAPABILITY_KINDS.map((kind) => ({ kind, items: map.get(kind) ?? [] })).filter(
      (group) => group.items.length > 0,
    );
  }, [registry]);

  return (
    <div className="space-y-6" data-api-docs-page="true">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-[var(--pf-fg)]">API</h1>
        <p className="text-sm text-[var(--pf-muted)]">
          {registry.application.name} {registry.application.version} · platform{" "}
          {registry.platformVersion}. The GUI and an LLM with an API key share this list.
        </p>
        <p className="flex flex-wrap gap-3 text-sm">
          <a
            href="/api/platform/openapi.json"
            className="text-[var(--pf-accent)] underline-offset-2 hover:underline"
          >
            openapi.json
          </a>
          <a
            href="/api/platform/llms.txt"
            className="text-[var(--pf-accent)] underline-offset-2 hover:underline"
          >
            llms.txt
          </a>
          <a
            href="/api/platform/registry"
            className="text-[var(--pf-accent)] underline-offset-2 hover:underline"
          >
            registry
          </a>
        </p>
      </header>
      {grouped.length === 0 ? (
        <EmptyState title="No capabilities" body="The registry is empty." />
      ) : (
        grouped.map((group) => (
          <section key={group.kind} className="space-y-3" data-api-docs-kind={group.kind}>
            <h2 className="text-base font-semibold text-[var(--pf-fg)]">{KIND_LABEL[group.kind]}</h2>
            <ul className="space-y-3">
              {group.items.map((capability) => (
                <li key={capability.id}>
                  <CapabilityCard capability={capability} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function CapabilityCard({ capability }: { capability: Capability }) {
  const [copied, setCopied] = useState(false);
  const curl = curlForCapability(capability);
  const roles = capability.roles.length ? capability.roles.join(", ") : "public";

  return (
    <article
      className="space-y-2 rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)] p-4"
      data-capability={capability.id}
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-xs uppercase text-[var(--pf-accent)]">{capability.method}</span>
        <code className="break-all font-mono text-sm text-[var(--pf-fg)]">{capability.path}</code>
        <span className="text-xs text-[var(--pf-muted)]">{roles}</span>
      </header>
      <p className="text-sm text-[var(--pf-muted)]">{capability.description}</p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-[var(--pf-radius-sm)] bg-[var(--pf-bg)] p-2 font-mono text-xs text-[var(--pf-fg)]">
        {curl}
      </pre>
      <button
        type="button"
        className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] px-3 py-2 text-sm text-[var(--pf-fg)]"
        onClick={() => {
          void navigator.clipboard?.writeText(curl).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy curl"}
      </button>
    </article>
  );
}
