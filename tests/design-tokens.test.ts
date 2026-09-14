import { describe, expect, it } from "vitest";
import { BadRequestError } from "../src/auth/errors.js";
import {
  DEFAULT_TOKENS,
  applyOverride,
  buildTimeTokens,
  generateTokensCss,
  parseDesignMd,
  publicOverride,
  sanitizeTokens,
  tokensFromSpec,
  tokensFromStored,
  tokensToCss,
  validateDesignOverride,
} from "../src/design/index.js";
import { VALID_DESIGN_MD, VALID_THEMED_MD } from "./design-fixtures.js";

describe("generateTokensCss", () => {
  it("emits --pf-* variables and never Voice text", () => {
    const spec = parseDesignMd(VALID_DESIGN_MD);
    const css = generateTokensCss(spec);
    expect(css).toBe(`/* generated from design.md — do not edit */

:root {
  --pf-bg: #0f1115;
  --pf-surface: #171b22;
  --pf-fg: #e8eaed;
  --pf-muted: #9aa3b2;
  --pf-accent: #6ea8fe;
  --pf-accent-fg: #0f1115;
  --pf-danger: #f87171;
  --pf-ok: #34d399;
  --pf-border: #2a3140;
  --pf-radius: 0.75rem;
  --pf-radius-sm: 0.375rem;
  --pf-radius-lg: 1rem;
  --pf-font: ui-sans-serif, system-ui, sans-serif;
  --pf-heading-font: "Iowan Old Style", serif;
  --pf-font-size: 16px;
  --pf-density: comfortable;
}
`);
    expect(css).not.toContain("calm and direct");
    expect(css).not.toContain("Don't invent");
    expect(css).not.toContain("Voice");
    expect(tokensFromSpec(spec)["--pf-accent"]).toBe("#6ea8fe");
  });

  it("emits light/dark theme blocks when design.md defines both", () => {
    const css = generateTokensCss(parseDesignMd(VALID_THEMED_MD));
    expect(css).toContain('[data-pf-theme="light"]');
    expect(css).toContain('[data-pf-theme="dark"]');
    expect(css).toContain("--pf-bg: #f8fafc;");
    expect(css).toContain("--pf-bg: #0b0d11;");
    expect(css).toContain("--pf-density: compact;");
    expect(css).not.toContain("warm");
  });
});

describe("sanitizeTokens / tokensToCss", () => {
  it("drops values that could break out of a CSS declaration", () => {
    const safe = sanitizeTokens({
      "--pf-bg": "#fff",
      "--pf-fg": "red; } html { color: lime",
      "--pf-accent": "x{y}",
      "--other": "#000",
    });
    expect(safe).toEqual({ "--pf-bg": "#fff" });
    expect(tokensToCss({ "--pf-bg": "#111111" })).toContain("--pf-bg: #111111;");
  });
});

describe("runtime override", () => {
  it("validates a subset and rejects voice / bad hex / CSS metacharacters", () => {
    const override = validateDesignOverride({
      colors: { accent: "#ff00aa" },
      typography: { headingFont: "Georgia, serif" },
      shape: { radiusMd: "4px" },
    });
    expect(override.colors?.accent).toBe("#ff00aa");
    expect(() => validateDesignOverride({ voice: { tone: "x" } })).toThrow(BadRequestError);
    expect(() => validateDesignOverride({ colors: { accent: "red" } })).toThrow(/invalid hex/);
    expect(() => validateDesignOverride({ typography: { bodyFont: "x; }" } })).toThrow(BadRequestError);
    expect(() => validateDesignOverride({ colors: { neon: "#ffffff" } })).toThrow(/unknown color/);
  });

  it("accepts a {markdown, spec} document and keeps the 0.10 form overlay", () => {
    const spec = parseDesignMd(VALID_DESIGN_MD);
    const stored = validateDesignOverride({
      markdown: VALID_DESIGN_MD,
      spec,
      source: "markdown",
    });
    expect(stored.spec?.brand.name).toBe("Example");
    expect(stored.markdown).toContain("# Brand");
    expect(stored.source).toBe("markdown");

    const fromSpecOnly = validateDesignOverride({ spec });
    expect(fromSpecOnly.spec?.colors.accent).toBe("#6ea8fe");
    expect(fromSpecOnly.source).toBe("markdown");

    const form = validateDesignOverride({ colors: { accent: "#ffffff" }, source: "form" });
    expect(form.colors?.accent).toBe("#ffffff");
    expect(form.spec).toBeUndefined();
    expect(form.source).toBe("form");

    expect(() => validateDesignOverride({ voice: { tone: "x" } })).toThrow(BadRequestError);
    expect(() => validateDesignOverride({ markdown: VALID_DESIGN_MD, colors: { accent: "#fff" } })).toThrow(
      /unknown design field/,
    );
  });

  it("applyOverride merges onto build-time tokens", () => {
    const base = buildTimeTokens(parseDesignMd(VALID_DESIGN_MD));
    const merged = applyOverride(base, { colors: { accent: "#abcdef" }, shape: { radiusMd: "2px" } });
    expect(merged["--pf-accent"]).toBe("#abcdef");
    expect(merged["--pf-radius"]).toBe("2px");
    expect(merged["--pf-bg"]).toBe("#0f1115");
    expect(buildTimeTokens(null, { "--pf-bg": "#010101" })["--pf-bg"]).toBe("#010101");
    expect(buildTimeTokens()["--pf-accent"]).toBe(DEFAULT_TOKENS["--pf-accent"]);
  });

  it("tokensFromStored replaces from spec and publicOverride strips markdown/voice", () => {
    const base = { "--pf-accent": "#000000", "--pf-bg": "#111111" };
    const document = validateDesignOverride({ markdown: VALID_DESIGN_MD, source: "markdown" });
    const fromDoc = tokensFromStored(base, document);
    expect(fromDoc["--pf-accent"]).toBe("#6ea8fe");
    expect(fromDoc["--pf-heading-font"]).toContain("Iowan");

    const form = validateDesignOverride({ colors: { accent: "#abcdef" } });
    const fromForm = tokensFromStored(base, form);
    expect(fromForm["--pf-accent"]).toBe("#abcdef");
    expect(fromForm["--pf-bg"]).toBe("#111111");

    const published = publicOverride(document);
    expect(published?.source).toBe("markdown");
    expect(published?.typography?.headingFont).toContain("Iowan");
    expect(published).not.toHaveProperty("markdown");
    expect(published).not.toHaveProperty("spec");
    expect(JSON.stringify(published)).not.toContain("# Brand");
    expect(JSON.stringify(published)).not.toContain("calm and direct");
    expect(publicOverride(null)).toBeNull();
  });
});
