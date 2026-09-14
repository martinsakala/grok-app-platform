import { DesignParseError, type ColorTokens, type DesignSpec } from "./types.js";

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

type SectionId = "brand" | "colors" | "colorsLight" | "colorsDark" | "typography" | "shape" | "voice";

const SECTION_BY_HEADING: Record<string, SectionId> = {
  brand: "brand",
  colors: "colors",
  "colors (light)": "colorsLight",
  "colors (dark)": "colorsDark",
  typography: "typography",
  shape: "shape",
  voice: "voice",
};

const COLOR_KEYS: Record<string, keyof ColorTokens> = {
  bg: "bg",
  surface: "surface",
  fg: "fg",
  muted: "muted",
  accent: "accent",
  "accent-fg": "accentFg",
  accentfg: "accentFg",
  danger: "danger",
  ok: "ok",
  border: "border",
};

const REQUIRED_COLORS: (keyof ColorTokens)[] = [
  "bg",
  "surface",
  "fg",
  "muted",
  "accent",
  "accentFg",
  "danger",
  "ok",
];

function headingId(raw: string): SectionId {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const id = SECTION_BY_HEADING[normalized];
  if (!id) {
    throw new DesignParseError(0, `unknown section "${raw.trim()}"`);
  }
  return id;
}

function splitKv(line: string): { key: string; value: string } | null {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim().toLowerCase().replace(/_/g, "-");
  const value = line.slice(idx + 1).trim();
  if (!key) return null;
  return { key, value };
}

function requireHex(line: number, field: string, value: string): string {
  if (!HEX.test(value)) {
    throw new DesignParseError(line, `invalid hex for ${field}: ${JSON.stringify(value)}`);
  }
  return value;
}

function requireText(line: number, field: string, value: string): string {
  if (!value) throw new DesignParseError(line, `missing value for ${field}`);
  return value;
}

export function parseDesignMd(markdown: string): DesignSpec {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const seen = new Map<SectionId, number>();
  let section: SectionId | null = null;
  let sectionLine = 1;

  const brand: Partial<{ name: string; tagline: string }> = {};
  const colors: Partial<ColorTokens> = {};
  let colorsLight: Partial<ColorTokens> | undefined;
  let colorsDark: Partial<ColorTokens> | undefined;
  const typography: Partial<{ headingFont: string; bodyFont: string; baseSize: string }> = {};
  const shape: Partial<{ radiusSm: string; radiusMd: string; radiusLg: string; density: string }> = {};
  const voice: Partial<{ tone: string; do: string; dont: string }> = {};

  function colorTarget(): Partial<ColorTokens> {
    if (section === "colorsLight") {
      if (!colorsLight) colorsLight = {};
      return colorsLight;
    }
    if (section === "colorsDark") {
      if (!colorsDark) colorsDark = {};
      return colorsDark;
    }
    return colors;
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("<!--") || trimmed.startsWith("-->")) continue;
    if (trimmed === "---") continue;
    if (trimmed.startsWith(">")) continue;

    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      try {
        section = headingId(heading[1] ?? "");
      } catch (error) {
        if (error instanceof DesignParseError) {
          throw new DesignParseError(lineNo, `unknown section "${(heading[1] ?? "").trim()}"`);
        }
        throw error;
      }
      if (seen.has(section)) {
        throw new DesignParseError(lineNo, `duplicate section "${heading[1]?.trim()}"`);
      }
      seen.set(section, lineNo);
      sectionLine = lineNo;
      continue;
    }

    if (!section) {
      throw new DesignParseError(lineNo, `expected a section heading before ${JSON.stringify(trimmed)}`);
    }

    const kv = splitKv(trimmed);
    if (!kv) {
      throw new DesignParseError(lineNo, `expected "key: value", got ${JSON.stringify(trimmed)}`);
    }

    if (section === "brand") {
      if (kv.key === "name") brand.name = requireText(lineNo, "name", kv.value);
      else if (kv.key === "tagline") brand.tagline = requireText(lineNo, "tagline", kv.value);
      else throw new DesignParseError(lineNo, `unknown Brand key "${kv.key}"`);
      continue;
    }

    if (section === "colors" || section === "colorsLight" || section === "colorsDark") {
      const mapped = COLOR_KEYS[kv.key];
      if (!mapped) throw new DesignParseError(lineNo, `unknown Colors key "${kv.key}"`);
      colorTarget()[mapped] = requireHex(lineNo, kv.key, kv.value);
      continue;
    }

    if (section === "typography") {
      if (kv.key === "heading font" || kv.key === "heading-font") {
        typography.headingFont = requireText(lineNo, "heading font", kv.value);
      } else if (kv.key === "body font" || kv.key === "body-font") {
        typography.bodyFont = requireText(lineNo, "body font", kv.value);
      } else if (kv.key === "base size" || kv.key === "base-size") {
        typography.baseSize = requireText(lineNo, "base size", kv.value);
      } else {
        throw new DesignParseError(lineNo, `unknown Typography key "${kv.key}"`);
      }
      continue;
    }

    if (section === "shape") {
      if (kv.key === "radius sm" || kv.key === "radius-sm") shape.radiusSm = requireText(lineNo, "radius sm", kv.value);
      else if (kv.key === "radius md" || kv.key === "radius-md") shape.radiusMd = requireText(lineNo, "radius md", kv.value);
      else if (kv.key === "radius lg" || kv.key === "radius-lg") shape.radiusLg = requireText(lineNo, "radius lg", kv.value);
      else if (kv.key === "density") shape.density = requireText(lineNo, "density", kv.value);
      else throw new DesignParseError(lineNo, `unknown Shape key "${kv.key}"`);
      continue;
    }

    if (section === "voice") {
      if (kv.key === "tone") voice.tone = kv.value;
      else if (kv.key === "do") voice.do = kv.value;
      else if (kv.key === "don't" || kv.key === "dont" || kv.key === "do-not" || kv.key === "do not") {
        voice.dont = kv.value;
      } else throw new DesignParseError(lineNo, `unknown Voice key "${kv.key}"`);
    }
  }

  function needSection(id: SectionId, title: string): number {
    const line = seen.get(id);
    if (!line) throw new DesignParseError(lines.length || 1, `missing section ${title}`);
    return line;
  }

  const brandLine = needSection("brand", "Brand");
  const colorLine = needSection("colors", "Colors");
  const typeLine = needSection("typography", "Typography");
  const shapeLine = needSection("shape", "Shape");
  const voiceLine = needSection("voice", "Voice");

  if (!brand.name) throw new DesignParseError(brandLine, "Brand is missing name");
  if (!brand.tagline) throw new DesignParseError(brandLine, "Brand is missing tagline");

  for (const key of REQUIRED_COLORS) {
    if (!colors[key]) throw new DesignParseError(colorLine, `Colors is missing ${key === "accentFg" ? "accent-fg" : key}`);
  }
  function completeColors(partial: Partial<ColorTokens> | undefined, line: number, label: string): ColorTokens | undefined {
    if (!partial) return undefined;
    for (const key of REQUIRED_COLORS) {
      if (!partial[key]) {
        throw new DesignParseError(line, `${label} is missing ${key === "accentFg" ? "accent-fg" : key}`);
      }
    }
    return partial as ColorTokens;
  }
  const light = completeColors(colorsLight, seen.get("colorsLight") ?? colorLine, "Colors (light)");
  const dark = completeColors(colorsDark, seen.get("colorsDark") ?? colorLine, "Colors (dark)");

  if (!typography.headingFont) throw new DesignParseError(typeLine, "Typography is missing heading font");
  if (!typography.bodyFont) throw new DesignParseError(typeLine, "Typography is missing body font");
  if (!typography.baseSize) throw new DesignParseError(typeLine, "Typography is missing base size");

  if (!shape.radiusSm) throw new DesignParseError(shapeLine, "Shape is missing radius sm");
  if (!shape.radiusMd) throw new DesignParseError(shapeLine, "Shape is missing radius md");
  if (!shape.radiusLg) throw new DesignParseError(shapeLine, "Shape is missing radius lg");
  if (!shape.density) throw new DesignParseError(shapeLine, "Shape is missing density");

  if (voice.tone === undefined) throw new DesignParseError(voiceLine, "Voice is missing tone");
  if (voice.do === undefined) throw new DesignParseError(voiceLine, 'Voice is missing do');
  if (voice.dont === undefined) throw new DesignParseError(voiceLine, "Voice is missing don't");

  void sectionLine;
  return {
    brand: { name: brand.name, tagline: brand.tagline },
    colors: colors as ColorTokens,
    ...(light ? { colorsLight: light } : {}),
    ...(dark ? { colorsDark: dark } : {}),
    typography: {
      headingFont: typography.headingFont,
      bodyFont: typography.bodyFont,
      baseSize: typography.baseSize,
    },
    shape: {
      radiusSm: shape.radiusSm,
      radiusMd: shape.radiusMd,
      radiusLg: shape.radiusLg,
      density: shape.density,
    },
    voice: { tone: voice.tone, do: voice.do, dont: voice.dont },
  };
}
