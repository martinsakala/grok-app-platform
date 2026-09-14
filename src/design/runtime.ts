import { BadRequestError } from "../auth/errors.js";
import { DEFAULT_TOKENS, sanitizeTokens, tokensFromSpec } from "./tokens.js";
import type { ColorTokens, DesignOverride, DesignSpec, DesignTokens, ShapeSpec, TypographySpec } from "./types.js";

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const COLOR_FIELDS = ["bg", "surface", "fg", "muted", "accent", "accentFg", "danger", "ok", "border"] as const;
const TYPE_FIELDS = ["headingFont", "bodyFont", "baseSize"] as const;
const SHAPE_FIELDS = ["radiusSm", "radiusMd", "radiusLg", "density"] as const;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalHex(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !HEX.test(value)) {
    throw new BadRequestError(`invalid hex for ${field}`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestError(`invalid ${field}`);
  }
  if (/[;{}]/.test(value)) {
    throw new BadRequestError(`invalid ${field}`);
  }
  return value;
}

export function validateDesignOverride(value: unknown): DesignOverride {
  const rec = asRecord(value, "design");
  const allowed = new Set(["colors", "typography", "shape"]);
  for (const key of Object.keys(rec)) {
    if (!allowed.has(key)) throw new BadRequestError(`unknown design field "${key}"`);
  }
  const out: DesignOverride = {};
  if (rec.colors !== undefined) {
    const colors = asRecord(rec.colors, "colors");
    const mapped: Partial<ColorTokens> = {};
    for (const key of Object.keys(colors)) {
      if (!(COLOR_FIELDS as readonly string[]).includes(key)) {
        throw new BadRequestError(`unknown color "${key}"`);
      }
      const hex = optionalHex(colors[key], key);
      if (hex) (mapped as Record<string, string>)[key] = hex;
    }
    out.colors = mapped;
  }
  if (rec.typography !== undefined) {
    const typography = asRecord(rec.typography, "typography");
    const mapped: Partial<TypographySpec> = {};
    for (const key of Object.keys(typography)) {
      if (!(TYPE_FIELDS as readonly string[]).includes(key)) {
        throw new BadRequestError(`unknown typography "${key}"`);
      }
      const text = optionalText(typography[key], key);
      if (text) (mapped as Record<string, string>)[key] = text;
    }
    out.typography = mapped;
  }
  if (rec.shape !== undefined) {
    const shape = asRecord(rec.shape, "shape");
    const mapped: Partial<ShapeSpec> = {};
    for (const key of Object.keys(shape)) {
      if (!(SHAPE_FIELDS as readonly string[]).includes(key)) {
        throw new BadRequestError(`unknown shape "${key}"`);
      }
      const text = optionalText(shape[key], key);
      if (text) (mapped as Record<string, string>)[key] = text;
    }
    out.shape = mapped;
  }
  return out;
}

export function applyOverride(base: DesignTokens, override: DesignOverride | null | undefined): DesignTokens {
  const next: DesignTokens = { ...sanitizeTokens({ ...DEFAULT_TOKENS, ...base }) };
  if (!override) return next;
  const c = override.colors;
  if (c?.bg) next["--pf-bg"] = c.bg;
  if (c?.surface) next["--pf-surface"] = c.surface;
  if (c?.fg) next["--pf-fg"] = c.fg;
  if (c?.muted) next["--pf-muted"] = c.muted;
  if (c?.accent) next["--pf-accent"] = c.accent;
  if (c?.accentFg) next["--pf-accent-fg"] = c.accentFg;
  if (c?.danger) next["--pf-danger"] = c.danger;
  if (c?.ok) next["--pf-ok"] = c.ok;
  if (c?.border) next["--pf-border"] = c.border;
  const t = override.typography;
  if (t?.bodyFont) next["--pf-font"] = t.bodyFont;
  if (t?.headingFont) next["--pf-heading-font"] = t.headingFont;
  if (t?.baseSize) next["--pf-font-size"] = t.baseSize;
  const s = override.shape;
  if (s?.radiusMd) next["--pf-radius"] = s.radiusMd;
  if (s?.radiusSm) next["--pf-radius-sm"] = s.radiusSm;
  if (s?.radiusLg) next["--pf-radius-lg"] = s.radiusLg;
  if (s?.density) next["--pf-density"] = s.density;
  return sanitizeTokens(next);
}

export function buildTimeTokens(spec?: DesignSpec | null, explicit?: DesignTokens | null): DesignTokens {
  if (explicit) return sanitizeTokens({ ...DEFAULT_TOKENS, ...explicit });
  if (spec) return sanitizeTokens({ ...DEFAULT_TOKENS, ...tokensFromSpec(spec) });
  return { ...DEFAULT_TOKENS };
}
