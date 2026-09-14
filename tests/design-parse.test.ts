import { describe, expect, it } from "vitest";
import { DesignParseError, parseDesignMd } from "../src/design/index.js";
import { VALID_DESIGN_MD, VALID_THEMED_MD } from "./design-fixtures.js";

describe("parseDesignMd", () => {
  it("parses a valid design.md", () => {
    const spec = parseDesignMd(VALID_DESIGN_MD);
    expect(spec.brand).toEqual({ name: "Example", tagline: "A sample app" });
    expect(spec.colors.accentFg).toBe("#0f1115");
    expect(spec.colors.ok).toBe("#34d399");
    expect(spec.colors.border).toBe("#2a3140");
    expect(spec.typography.headingFont).toBe('"Iowan Old Style", serif');
    expect(spec.shape.radiusMd).toBe("0.75rem");
    expect(spec.voice.dont).toBe("Don't invent a second palette.");
    expect(spec.colorsLight).toBeUndefined();
    expect(spec.colorsDark).toBeUndefined();
  });

  it("parses optional light/dark color sections", () => {
    const spec = parseDesignMd(VALID_THEMED_MD);
    expect(spec.colorsLight?.bg).toBe("#f8fafc");
    expect(spec.colorsDark?.bg).toBe("#0b0d11");
    expect(spec.typography.baseSize).toBe("18px");
    expect(spec.voice.dont).toBe("Don't shout.");
  });

  it("rejects a missing section with a line-numbered error", () => {
    const md = VALID_DESIGN_MD.replace(/# Voice[\s\S]*$/, "");
    expect(() => parseDesignMd(md)).toThrow(DesignParseError);
    try {
      parseDesignMd(md);
    } catch (error) {
      expect(error).toBeInstanceOf(DesignParseError);
      const parsed = error as DesignParseError;
      expect(parsed.message).toMatch(/^design.md:\d+: missing section Voice$/);
      expect(parsed.line).toBeGreaterThan(0);
    }
  });

  it("rejects a missing required color key", () => {
    const md = VALID_DESIGN_MD.replace("ok: #34d399\n", "");
    expect(() => parseDesignMd(md)).toThrow(/design.md:\d+: Colors is missing ok/);
  });

  it("rejects a bad hex with the offending line number", () => {
    const md = VALID_DESIGN_MD.replace("accent: #6ea8fe", "accent: not-a-color");
    try {
      parseDesignMd(md);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignParseError);
      const parsed = error as DesignParseError;
      expect(parsed.message).toMatch(/invalid hex for accent: "not-a-color"/);
      expect(parsed.message.startsWith(`design.md:${parsed.line}:`)).toBe(true);
      expect(md.split("\n")[parsed.line - 1]).toContain("accent: not-a-color");
    }
  });

  it("rejects unknown sections, unknown keys, and duplicates", () => {
    expect(() => parseDesignMd(`${VALID_DESIGN_MD}\n# Widgets\nfoo: bar\n`)).toThrow(
      /unknown section "Widgets"/,
    );
    expect(() => parseDesignMd(VALID_DESIGN_MD.replace("name: Example", "title: Example"))).toThrow(
      /unknown Brand key "title"/,
    );
    expect(() => parseDesignMd(`# Brand\nname: A\ntagline: B\n# Brand\nname: C\ntagline: D\n`)).toThrow(
      /duplicate section "Brand"/,
    );
  });

  it("accepts 3-digit hex", () => {
    const md = VALID_DESIGN_MD.replace("ok: #34d399", "ok: #3d9");
    expect(parseDesignMd(md).colors.ok).toBe("#3d9");
  });
});
