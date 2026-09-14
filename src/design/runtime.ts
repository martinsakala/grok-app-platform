import { BadRequestError } from "../auth/errors.js";
import { parseDesignMd } from "./parse.js";
import { DEFAULT_TOKENS, sanitizeTokens, tokensFromSpec } from "./tokens.js";
import type {
  ColorTokens,
  DesignOverride,
  DesignSource,
  DesignSpec,
  DesignTokens,
  ShapeSpec,
  StoredDesign,
  TypographySpec,
} from "./types.js";
import { DesignParseError } from "./types.js";

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const COLOR_FIELDS = ["bg", "surface", "fg", "muted", "accent", "accentFg", "danger", "ok", "border"] as const;
const TYPE_FIELDS = ["headingFont", "bodyFont", "baseSize"] as const;
const SHAPE_FIELDS = ["radiusSm", "radiusMd", "radiusLg", "density"] as const;
const SOURCES = new Set<DesignSource>(["markdown", "preset", "form"]);
const DOC_KEYS = new Set(["markdown", "spec", "source", "preset"]);
const FORM_KEYS = new Set(["colors", "typography", "shape", "source"]);

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

function optionalSource(value: unknown): DesignSource | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !SOURCES.has(value as DesignSource)) {
    throw new BadRequestError(`invalid source`);
  }
  return value as DesignSource;
}

function parsePartialColors(value: unknown): Partial<ColorTokens> {
  const colors = asRecord(value, "colors");
  const mapped: Partial<ColorTokens> = {};
  for (const key of Object.keys(colors)) {
    if (!(COLOR_FIELDS as readonly string[]).includes(key)) {
      throw new BadRequestError(`unknown color "${key}"`);
    }
    const hex = optionalHex(colors[key], key);
    if (hex) (mapped as Record<string, string>)[key] = hex;
  }
  return mapped;
}

function parsePartialTypography(value: unknown): Partial<TypographySpec> {
  const typography = asRecord(value, "typography");
  const mapped: Partial<TypographySpec> = {};
  for (const key of Object.keys(typography)) {
    if (!(TYPE_FIELDS as readonly string[]).includes(key)) {
      throw new BadRequestError(`unknown typography "${key}"`);
    }
    const text = optionalText(typography[key], key);
    if (text) (mapped as Record<string, string>)[key] = text;
  }
  return mapped;
}

function parsePartialShape(value: unknown): Partial<ShapeSpec> {
  const shape = asRecord(value, "shape");
  const mapped: Partial<ShapeSpec> = {};
  for (const key of Object.keys(shape)) {
    if (!(SHAPE_FIELDS as readonly string[]).includes(key)) {
      throw new BadRequestError(`unknown shape "${key}"`);
    }
    const text = optionalText(shape[key], key);
    if (text) (mapped as Record<string, string>)[key] = text;
  }
  return mapped;
}

function validateSpecObject(value: unknown): DesignSpec {
  const rec = asRecord(value, "spec");
  const brand = asRecord(rec.brand, "brand");
  const colors = parsePartialColors(rec.colors);
  const typography = parsePartialTypography(rec.typography);
  const shape = parsePartialShape(rec.shape);
  const voice = asRecord(rec.voice, "voice");
  const requiredColors: (keyof ColorTokens)[] = [
    "bg",
    "surface",
    "fg",
    "muted",
    "accent",
    "accentFg",
    "danger",
    "ok",
  ];
  for (const key of requiredColors) {
    if (!colors[key]) throw new BadRequestError(`spec colors missing ${key}`);
  }
  if (typeof brand.name !== "string" || !brand.name) throw new BadRequestError("spec brand missing name");
  if (typeof brand.tagline !== "string" || !brand.tagline) throw new BadRequestError("spec brand missing tagline");
  if (!typography.headingFont || !typography.bodyFont || !typography.baseSize) {
    throw new BadRequestError("spec typography incomplete");
  }
  if (!shape.radiusSm || !shape.radiusMd || !shape.radiusLg || !shape.density) {
    throw new BadRequestError("spec shape incomplete");
  }
  if (typeof voice.tone !== "string" || typeof voice.do !== "string" || typeof voice.dont !== "string") {
    throw new BadRequestError("spec voice incomplete");
  }
  const spec: DesignSpec = {
    brand: { name: brand.name, tagline: brand.tagline },
    colors: colors as ColorTokens,
    typography: typography as TypographySpec,
    shape: shape as ShapeSpec,
    voice: { tone: voice.tone, do: voice.do, dont: voice.dont },
  };
  if (rec.colorsLight) spec.colorsLight = parsePartialColors(rec.colorsLight) as ColorTokens;
  if (rec.colorsDark) spec.colorsDark = parsePartialColors(rec.colorsDark) as ColorTokens;
  return spec;
}

export function validateDesignOverride(value: unknown): StoredDesign {
  const rec = asRecord(value, "design");
  const isDocument = rec.markdown !== undefined || rec.spec !== undefined;
  const allowed = isDocument ? DOC_KEYS : FORM_KEYS;
  for (const key of Object.keys(rec)) {
    if (!allowed.has(key)) throw new BadRequestError(`unknown design field "${key}"`);
  }

  if (isDocument) {
    let spec: DesignSpec | undefined;
    let markdown: string | undefined;
    if (rec.markdown !== undefined) {
      if (typeof rec.markdown !== "string" || !rec.markdown.trim()) {
        throw new BadRequestError("markdown must be a non-empty string");
      }
      markdown = rec.markdown;
      try {
        spec = parseDesignMd(markdown);
      } catch (error) {
        if (error instanceof DesignParseError) throw new BadRequestError(error.message);
        throw error;
      }
    } else if (rec.spec !== undefined) {
      spec = validateSpecObject(rec.spec);
    }
    if (!spec) throw new BadRequestError("design document is missing spec");
    const source = optionalSource(rec.source) ?? (typeof rec.preset === "string" ? "preset" : "markdown");
    const out: StoredDesign = { markdown, spec, source };
    if (typeof rec.preset === "string" && rec.preset.trim()) out.preset = rec.preset.trim();
    return out;
  }

  const out: StoredDesign = {};
  const source = optionalSource(rec.source);
  if (source) out.source = source;
  if (rec.colors !== undefined) out.colors = parsePartialColors(rec.colors);
  if (rec.typography !== undefined) out.typography = parsePartialTypography(rec.typography);
  if (rec.shape !== undefined) out.shape = parsePartialShape(rec.shape);
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
  if (c?.danger) next["--pf-danger"] = c.danger;
  if (c?.ok) next["--pf-ok"] = c.ok;
  if (c?.border) next["--pf-border"] = c.border;
  if (c?.accentFg) next["--pf-accent-fg"] = c.accentFg;
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

export function tokensFromStored(base: DesignTokens, stored: StoredDesign | null | undefined): DesignTokens {
  if (!stored) return applyOverride(base, null);
  if (stored.spec) {
    return sanitizeTokens({ ...DEFAULT_TOKENS, ...tokensFromSpec(stored.spec) });
  }
  return applyOverride(base, stored);
}

export function publicOverride(stored: StoredDesign | null | undefined): (DesignOverride & { source: DesignSource }) | null {
  if (!stored) return null;
  const source: DesignSource =
    stored.source ?? (stored.markdown ? "markdown" : stored.preset ? "preset" : "form");
  if (stored.spec) {
    return {
      colors: stored.spec.colors,
      typography: stored.spec.typography,
      shape: stored.spec.shape,
      source,
    };
  }
  return {
    colors: stored.colors,
    typography: stored.typography,
    shape: stored.shape,
    source,
  };
}

export function buildTimeTokens(spec?: DesignSpec | null, explicit?: DesignTokens | null): DesignTokens {
  if (explicit) return sanitizeTokens({ ...DEFAULT_TOKENS, ...explicit });
  if (spec) return sanitizeTokens({ ...DEFAULT_TOKENS, ...tokensFromSpec(spec) });
  return { ...DEFAULT_TOKENS };
}
