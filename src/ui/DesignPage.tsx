"use client";

import { useEffect, useMemo, useState } from "react";
import { roleCovers } from "../auth/roles.js";
import {
  applyOverride,
  DEFAULT_TOKENS,
  DESIGN_PROMPT,
  parseDesignMd,
  tokensFromSpec,
  tokensToCss,
  type DesignOverride,
  type DesignParseIssue,
  type DesignTokens,
} from "../design/index.js";
import { DesignParseError } from "../design/types.js";
import type { PlatformClient } from "./client.js";
import { ErrorState, ForbiddenState, LoadingState } from "./states.js";
import type { DesignGalleryPreset, DesignResponse, MeResponse } from "./types.js";

export type DesignPreview =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "forbidden" }
  | { status: "data"; me: MeResponse; design: DesignResponse; gallery?: DesignGalleryPreset[] };

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
    source: "form",
  };
}

function parseIssues(markdown: string): { tokens: DesignTokens | null; errors: DesignParseIssue[] } {
  try {
    const spec = parseDesignMd(markdown);
    return { tokens: tokensFromSpec(spec), errors: [] };
  } catch (error) {
    if (error instanceof DesignParseError) {
      return { tokens: null, errors: [{ line: error.line, message: error.message }] };
    }
    return {
      tokens: null,
      errors: [{ line: 1, message: error instanceof Error ? error.message : "Invalid design.md" }],
    };
  }
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

const inputClass =
  "w-full rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-bg)] px-3 py-2 text-sm text-[var(--pf-fg)]";
const buttonAccent =
  "rounded-[var(--pf-radius)] border border-[var(--pf-accent)] px-4 py-2 text-sm text-[var(--pf-accent)] disabled:opacity-50";
const buttonMuted =
  "rounded-[var(--pf-radius)] border border-[var(--pf-border)] px-4 py-2 text-sm text-[var(--pf-muted)] disabled:opacity-50";

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
  const [draft, setDraft] = useState("");
  const [issues, setIssues] = useState<DesignParseIssue[]>([]);
  const [gallery, setGallery] = useState<DesignGalleryPreset[]>(
    preview && preview.status === "data" ? (preview.gallery ?? []) : [],
  );
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
        let presets: DesignGalleryPreset[] = [];
        try {
          presets = (await client.listDesignGallery()).presets;
        } catch {
          presets = [];
        }
        if (!cancelled) {
          setView({ status: "data", me, design });
          setForm(tokensToForm(design.tokens));
          setGallery(presets);
        }
      } catch (error) {
        if (!cancelled) setView({ status: "error", error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, preview]);

  const draftParsed = useMemo(() => (draft.trim() ? parseIssues(draft) : { tokens: null, errors: [] }), [draft]);
  const previewTokens = useMemo(() => {
    if (draftParsed.tokens) return draftParsed.tokens;
    return applyOverride(view.status === "data" ? view.design.tokens : DEFAULT_TOKENS, formToOverride(form));
  }, [draftParsed.tokens, form, view]);

  if (view.status === "loading") return <LoadingState label="Loading design" />;
  if (view.status === "error") return <ErrorState error={view.error} />;
  if (view.status === "forbidden") return <ForbiddenState>Owner role required.</ForbiddenState>;

  const me = view.me;

  function applyDesign(design: DesignResponse) {
    setView({ status: "data", me, design });
    setForm(tokensToForm(design.tokens));
    setIssues([]);
  }

  function patch<K extends keyof FormState>(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="space-y-8">
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

      <section className="space-y-3" data-design-import="true">
        <h2 className="text-base font-semibold text-[var(--pf-fg)]">Import</h2>
        <textarea
          className={`${inputClass} min-h-40 font-mono text-xs`}
          placeholder="Paste design.md here"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setIssues([]);
          }}
        />
        <label className="block text-sm text-[var(--pf-muted)]">
          Upload .md
          <input
            type="file"
            accept=".md,text/markdown,text/plain"
            className="mt-1 block text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void file.text().then((text) => {
                setDraft(text);
                setIssues([]);
              });
            }}
          />
        </label>
        {issues.length > 0 || draftParsed.errors.length > 0 ? (
          <ul className="space-y-1 text-sm text-[var(--pf-danger)]" data-design-errors="true">
            {(issues.length ? issues : draftParsed.errors).map((issue) => (
              <li key={`${issue.line}-${issue.message}`}>
                Line {issue.line}: {issue.message}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={buttonMuted}
            onClick={() => setIssues(parseIssues(draft).errors)}
          >
            Validate
          </button>
          <button
            type="button"
            disabled={busy || !draft.trim()}
            className={buttonAccent}
            onClick={() => {
              setBusy(true);
              void client
                .importDesign({ markdown: draft })
                .then((design) => {
                  applyDesign(design);
                  setDraft("");
                })
                .catch((error) => {
                  const parsed = parseIssues(draft);
                  if (parsed.errors.length) {
                    setIssues(parsed.errors);
                    return;
                  }
                  setView({ status: "error", error });
                })
                .finally(() => setBusy(false));
            }}
          >
            Apply
          </button>
        </div>
      </section>

      <section className="space-y-3" data-design-gallery="true">
        <h2 className="text-base font-semibold text-[var(--pf-fg)]">Gallery</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {gallery.map((preset) => (
            <article
              key={preset.id}
              className="rounded-[var(--pf-radius)] border border-[var(--pf-border)] bg-[var(--pf-surface)] p-3"
            >
              <p className="font-medium text-[var(--pf-fg)]">{preset.name}</p>
              <p className="text-xs text-[var(--pf-muted)]">{preset.tagline}</p>
              <div className="mt-2 flex gap-1" aria-hidden="true">
                {["bg", "surface", "accent", "fg", "danger"].map((key) => (
                  <span
                    key={key}
                    className="h-6 w-6 rounded-sm border border-[var(--pf-border)]"
                    style={{ background: (preset.colors as Record<string, string>)[key] }}
                  />
                ))}
              </div>
              <button
                type="button"
                disabled={busy}
                className={`${buttonAccent} mt-3`}
                onClick={() => {
                  setBusy(true);
                  void client
                    .importDesign({ preset: preset.id })
                    .then((design) => applyDesign(design))
                    .catch((error) => setView({ status: "error", error }))
                    .finally(() => setBusy(false));
                }}
              >
                Use
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3" data-design-export="true">
        <h2 className="text-base font-semibold text-[var(--pf-fg)]">Export</h2>
        <p className="text-sm text-[var(--pf-muted)]">
          Commit this file to the repo root: the coding agent reads design.md from the repository, not from the
          database
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            className={buttonAccent}
            onClick={() => {
              setBusy(true);
              void client
                .exportDesign()
                .then((markdown) => {
                  const blob = new Blob([markdown], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "design.md";
                  link.click();
                  URL.revokeObjectURL(url);
                })
                .catch((error) => setView({ status: "error", error }))
                .finally(() => setBusy(false));
            }}
          >
            Download design.md
          </button>
          <button
            type="button"
            className={buttonMuted}
            onClick={() => {
              void navigator.clipboard?.writeText(DESIGN_PROMPT).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy prompt for an LLM"}
          </button>
        </div>
      </section>

      <section className="space-y-3" data-design-finetune="true">
        <h2 className="text-base font-semibold text-[var(--pf-fg)]">Fine-tune</h2>
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
                  className={`${inputClass} font-mono text-xs`}
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
            className={`${inputClass} mt-1`}
            value={form.headingFont}
            onChange={(event) => patch("headingFont", event.target.value)}
          />
        </label>
        <label className="block text-sm text-[var(--pf-muted)]">
          Body font
          <input
            className={`${inputClass} mt-1`}
            value={form.bodyFont}
            onChange={(event) => patch("bodyFont", event.target.value)}
          />
        </label>
        <label className="block text-sm text-[var(--pf-muted)]">
          Radius
          <input
            className={`${inputClass} mt-1 font-mono`}
            value={form.radiusMd}
            onChange={(event) => patch("radiusMd", event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            className={buttonAccent}
            onClick={() => {
              setBusy(true);
              void client
                .setDesign(formToOverride(form))
                .then((design) => applyDesign(design))
                .catch((error) => setView({ status: "error", error }))
                .finally(() => setBusy(false));
            }}
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy}
            className={buttonMuted}
            onClick={() => {
              setBusy(true);
              void client
                .resetDesign()
                .then((design) => applyDesign(design))
                .catch((error) => setView({ status: "error", error }))
                .finally(() => setBusy(false));
            }}
          >
            Reset
          </button>
        </div>
      </section>
    </div>
  );
}
