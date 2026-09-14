export type ColorTokens = {
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  accentFg: string;
  danger: string;
  ok: string;
  border?: string;
};

export type TypographySpec = {
  headingFont: string;
  bodyFont: string;
  baseSize: string;
};

export type ShapeSpec = {
  radiusSm: string;
  radiusMd: string;
  radiusLg: string;
  density: string;
};

export type VoiceSpec = {
  tone: string;
  do: string;
  dont: string;
};

export type BrandSpec = {
  name: string;
  tagline: string;
};

export type DesignSpec = {
  brand: BrandSpec;
  colors: ColorTokens;
  colorsLight?: ColorTokens;
  colorsDark?: ColorTokens;
  typography: TypographySpec;
  shape: ShapeSpec;
  voice: VoiceSpec;
};

/** Runtime/JSON subset that may override build-time tokens. Voice never applies to CSS. */
export type DesignOverride = {
  colors?: Partial<ColorTokens>;
  typography?: Partial<TypographySpec>;
  shape?: Partial<ShapeSpec>;
};

export type DesignTokens = Record<string, string>;

export class DesignParseError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`design.md:${line}: ${message}`);
    this.name = "DesignParseError";
    this.line = line;
  }
}
