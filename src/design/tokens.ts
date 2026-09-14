import type { ColorTokens, DesignSpec, DesignTokens } from "./types.js";

/** Fallback `--pf-*` set matching `src/ui/tokens.css` plus 0.10.0 extras. */
export const DEFAULT_TOKENS: DesignTokens = {
  "--pf-bg": "#0f1115",
  "--pf-fg": "#e8eaed",
  "--pf-muted": "#9aa3b2",
  "--pf-accent": "#6ea8fe",
  "--pf-accent-fg": "#0f1115",
  "--pf-border": "#2a3140",
  "--pf-surface": "#171b22",
  "--pf-danger": "#f87171",
  "--pf-ok": "#34d399",
  "--pf-radius": "0.75rem",
  "--pf-radius-sm": "0.375rem",
  "--pf-radius-lg": "1rem",
  "--pf-font": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  "--pf-heading-font": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  "--pf-font-size": "16px",
  "--pf-density": "comfortable",
};

export const TOKEN_ORDER = [
  "--pf-bg",
  "--pf-surface",
  "--pf-fg",
  "--pf-muted",
  "--pf-accent",
  "--pf-accent-fg",
  "--pf-danger",
  "--pf-ok",
  "--pf-border",
  "--pf-radius",
  "--pf-radius-sm",
  "--pf-radius-lg",
  "--pf-font",
  "--pf-heading-font",
  "--pf-font-size",
  "--pf-density",
] as const;

function colorBlock(colors: ColorTokens): DesignTokens {
  return {
    "--pf-bg": colors.bg,
    "--pf-surface": colors.surface,
    "--pf-fg": colors.fg,
    "--pf-muted": colors.muted,
    "--pf-accent": colors.accent,
    "--pf-accent-fg": colors.accentFg,
    "--pf-danger": colors.danger,
    "--pf-ok": colors.ok,
    "--pf-border": colors.border ?? colors.surface,
  };
}

export function tokensFromSpec(spec: DesignSpec): DesignTokens {
  return {
    ...colorBlock(spec.colors),
    "--pf-radius": spec.shape.radiusMd,
    "--pf-radius-sm": spec.shape.radiusSm,
    "--pf-radius-lg": spec.shape.radiusLg,
    "--pf-font": spec.typography.bodyFont,
    "--pf-heading-font": spec.typography.headingFont,
    "--pf-font-size": spec.typography.baseSize,
    "--pf-density": spec.shape.density,
  };
}

function emitBlock(selector: string, tokens: DesignTokens, indent = ""): string {
  const lines = TOKEN_ORDER.filter((key) => tokens[key] !== undefined).map(
    (key) => `${indent}  ${key}: ${tokens[key]};`,
  );
  return `${indent}${selector} {\n${lines.join("\n")}\n${indent}}`;
}

export function generateTokensCss(spec: DesignSpec): string {
  const root = tokensFromSpec(spec);
  const parts = [
    "/* generated from design.md — do not edit */",
    emitBlock(":root", root),
  ];
  if (spec.colorsLight) {
    parts.push(emitBlock('[data-pf-theme="light"]', colorBlock(spec.colorsLight)));
  }
  if (spec.colorsDark) {
    parts.push(emitBlock('[data-pf-theme="dark"]', colorBlock(spec.colorsDark)));
  }
  return `${parts.join("\n\n")}\n`;
}

const CSS_VALUE = /^[^;{}]+$/;

export function sanitizeTokens(tokens: DesignTokens): DesignTokens {
  const out: DesignTokens = {};
  for (const key of TOKEN_ORDER) {
    const value = tokens[key];
    if (typeof value !== "string") continue;
    if (!key.startsWith("--pf-")) continue;
    if (!CSS_VALUE.test(value)) continue;
    out[key] = value;
  }
  return out;
}

export function tokensToCss(tokens: DesignTokens): string {
  const safe = sanitizeTokens(tokens);
  return emitBlock(":root", safe);
}
