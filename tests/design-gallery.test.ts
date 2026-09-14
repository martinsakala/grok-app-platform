import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DESIGN_GALLERY, parseDesignMd } from "../src/design/index.js";

const galleryDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "design", "gallery");

const EXPECTED_IDS = ["cool", "dark-neutral", "high-contrast", "light-neutral", "mono", "warm"];

describe("design gallery", () => {
  it("every preset markdown parses, has Voice, and is generated", () => {
    const files = readdirSync(galleryDir)
      .filter((name) => name.endsWith(".md"))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
    expect(files).toEqual(EXPECTED_IDS.map((id) => `${id}.md`));
    expect(DESIGN_GALLERY.map((entry) => entry.id)).toEqual(EXPECTED_IDS);

    for (const file of files) {
      const markdown = readFileSync(join(galleryDir, file), "utf8");
      const spec = parseDesignMd(markdown);
      expect(spec.brand.name.trim().length).toBeGreaterThan(0);
      expect(spec.voice.tone.trim().length).toBeGreaterThan(0);
      expect(spec.voice.do.trim().length).toBeGreaterThan(0);
      expect(spec.voice.dont.trim().length).toBeGreaterThan(0);
      expect(spec.colors.accent).toMatch(/^#/);

      const entry = DESIGN_GALLERY.find((item) => item.id === file.replace(/\.md$/, ""));
      expect(entry).toBeTruthy();
      expect(entry?.name).toBe(spec.brand.name);
      expect(entry?.tagline).toBe(spec.brand.tagline);
      expect(entry?.spec.colors.accent).toBe(spec.colors.accent);
      expect(entry?.markdown).toContain("# Voice");
    }
  });
});
