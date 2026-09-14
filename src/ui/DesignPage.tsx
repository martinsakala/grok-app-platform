"use client";

import { useEffect, useMemo, useState } from "react";
import { roleCovers } from "../auth/roles.js";
import { applyOverride, DEFAULT_TOKENS, tokensToCss, type DesignOverride, type DesignTokens } from "../design/index.js";
import type { PlatformClient } from "./client.js";
import { ErrorState, ForbiddenState, LoadingState } from "./states.js";
import type { DesignResponse, MeResponse } from "./types.js";

export type DesignPreview =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "forbidden" }
  | { status: "data"; me: MeResponse; design: DesignResponse };

type FormState = {
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  accentFg: string;
  danger: string;
  ok: string;
  headingFont: string;
  bodyFont: string;
  radiusMd: string;
};

function tokensToForm(tokens: DesignTokens): FormState {
  return {
    bg: tokens["--pf-bg"] ?? DEFAULT_TOKENS["--pf-bg"] ?? "#0f1115",
    surface: tokens["--pf-surface"] ?? DEFAULT_TOKENS["--pf-surface"] ?? "#171b22",
    fg: tokens["--pf-fg"] ?? DEFAULT_TOKENS["--pf-fg"] ?? "#e8eaed",
    muted: tokens["--pf-muted"] ?? DEFAULT_TOKENS["--pf-muted"] ?? "#9aa3b2",
    accent: tokens["--pf-accent"] ?? DEFAULT_TOKENS["--pf-accent"] ?? "#6ea8fe",
    accentFg: tokens["--pf-accent-fg"] ?? DEFAULT_TOKENS["--pf-accent-fg"] ?? "#0f1115",
    danger: tokens["--pf-danger"] ?? DEFAULT_TOKENS["--pf-danger"] ?? "#f87171",
    ok: tokens["--pf-ok"] ?? DEFAULT_TOKENS["--pf-ok"] ?? "#34d399",
    headingFont: tokens["--pf-heading-font"] ?? DEFAULT_TOKENS["--pf-heading-font"] ?? "sans-serif",
    bodyFont: tokens["--pf-font"] ?? DEFAULT_TOKENS["--pf-font"] ?? "sans-serif",
    radiusMd: tokens["--pf-radius"] ?? DEFAULT_TOKENS["--pf-radius"] ?? "0.75rem",
  };
}

function formToOverride(form: FormState): DesignOverride {
  return {
    colors: {
      bg: form.bg,
      surface: form.surface,
      fg: form.fg,
      muted: form.muted,
      accent: form.accent,
      accentFg: form.accentFg,
      danger: form.danger,
      ok: form.ok,
    },
    typography: { headingFont: form.headingFont, bodyFont: form.bodyFont },
    shape: { radiusMd: form.radiusMd },
  };
}

const COLOR_FIELDS: { key: keyof FormState; label: string }[] = [
  { key: "bg", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "fg", label: "Foreground" },
  { key: "muted", label: "Muted" },
  { key: "accent", label: "Accent" },
  { key: "accentFg", label: "Accent foreground" },
  { key: "danger", label: "Danger" },
  { key: "ok", label: "OK" },
];

export function DesignPage({
  client,
  preview,
}: {
  client: PlatformClient;
  preview?: DesignPreview;
}) {
  const [view, setView] = useState<DesignPreview>(preview ?? { status: "loading" });
  const [form, setForm] = useState<FormState>(() =>
    preview && preview.status === "data" ? tokensToForm(preview.design.tokens) : tokensToForm(DEFAULT_TOKENS),
  );
  const [busy, setBusy] = useState(false);

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
        const design = await client.getDesign();
        if (!cancelled) {
          setView({ status: "data", me, design });
          setForm(tokensToForm(design.tokens));
        }
      } catch (error) {
        if (!cancelled) setView({ status: "error", error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, preview]);

  const previewTokens = useMemo(
    () => applyOverride(view.status === "data" ? view.design.tokens : DEFAULT_TOKENS, formToOverride(form)),
    [form, view],
  );

  if (view.status === "loading") return <LoadingState label="Loading design" />;
  if (view.status === "error") return <ErrorState error={view.error} />;
  if (view.status === "forbidden") return <ForbiddenState>Owner role required.</ForbiddenState>;

  const me = view.me;

  function patch<K extends keyof FormState>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-6">
      <style data-pf-design-preview="">{tokensToCss(previewTokens)}</style>
      <h1 className="text-xl font-semibold text-[var(--pf-fg)]">Design</h1>
      <p className="text-sm text-[var(--pf-muted)]">
        Runtime overrides write <code>platform.design</code>. Voice stays in design.md and never reaches CSS.
      </p>
      <div
        className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)] p-4"
        data-design-preview="true"
      >
        <p className="text-lg font-semibold text-[var(--pf-fg)]" style={{ fontFamily: "var(--pf-heading-font)" }}>
          Preview heading
        </p>
        <p className="mt-1 text-sm text-[var(--pf-muted)]">Body copy on the surface color.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-[var(--pf-radius)] bg-[var(--pf-accent)] px-3 py-1 text-sm text-[var(--pf-accent-fg)]">
            Accent
          </span>
          <span className="rounded-[var(--pf-radius)] text-sm text-[var(--pf-danger)]">Danger</span>
          <span className="rounded-[var(--pf-radius)] text-sm text-[var(--pf-ok)]">OK</span>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {COLOR_FIELDS.map((field) => (
          <label key={field.key} className="block text-sm text-[var(--pf-muted)]">
            {field.label}
            <span className="mt-1 flex items-center gap-2">
              <input
                type="color"
                className="h-9 w-12 cursor-pointer rounded border border-[var(--pf-border)] bg-[var(--pf-bg)]"
                value={form[field.key].slice(0, 7)}
                onChange={(event) => patch(field.key, event.target.value)}
              />
              <input
                className="w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 font-mono text-xs text-[var(--pf-fg)]"
                value={form[field.key]}
                onChange={(event) => patch(field.key, event.target.value)}
              />
            </span>
          </label>
        ))}
      </div>
      <label className="block text-sm text-[var(--pf-muted)]">
        Heading font
        <input
          className="mt-1 w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 text-sm text-[var(--pf-fg)]"
          value={form.headingFont}
          onChange={(event) => patch("headingFont", event.target.value)}
        />
      </label>
      <label className="block text-sm text-[var(--pf-muted)]">
        Body font
        <input
          className="mt-1 w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 text-sm text-[var(--pf-fg)]"
          value={form.bodyFont}
          onChange={(event) => patch("bodyFont", event.target.value)}
        />
      </label>
      <label className="block text-sm text-[var(--pf-muted)]">
        Radius
        <input
          className="mt-1 w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 font-mono text-sm text-[var(--pf-fg)]"
          value={form.radiusMd}
          onChange={(event) => patch("radiusMd", event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          className="rounded-[var(--pf-radius)] border border-[var(--pf-accent)] px-4 py-2 text-sm text-[var(--pf-accent)]"
          onClick={() => {
            setBusy(true);
            void client
              .setDesign(formToOverride(form))
              .then((design) => {
                setView({ status: "data", me, design });
                setForm(tokensToForm(design.tokens));
              })
              .catch((error) => setView({ status: "error", error }))
              .finally(() => setBusy(false));
          }}
        >
          Save
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] px-4 py-2 text-sm text-[var(--pf-muted)]"
          onClick={() => {
            setBusy(true);
            void client
              .resetDesign()
              .then((design) => {
                setView({ status: "data", me, design });
                setForm(tokensToForm(design.tokens));
              })
              .catch((error) => setView({ status: "error", error }))
              .finally(() => setBusy(false));
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
