import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { VALID_DESIGN_MD } from "./design-fixtures.js";

const SCRIPT = new URL("../scripts/generate-design-tokens.mjs", import.meta.url).pathname;

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", SCRIPT, ...args], {
    encoding: "utf8",
  });
}

describe("generate-design-tokens CLI", () => {
  it("writes CSS from a valid design.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "design-cli-"));
    const input = join(dir, "design.md");
    const output = join(dir, "out", "tokens.css");
    writeFileSync(input, VALID_DESIGN_MD);
    const result = runCli([input, output]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const css = readFileSync(output, "utf8");
    expect(css).toContain("--pf-accent: #6ea8fe;");
    expect(css).toContain(":root {");
    expect(css).not.toContain("calm and direct");
    expect(result.stdout).toMatch(/Wrote /);
  });

  it("exits 2 when arguments are missing", () => {
    const result = runCli([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage: generate-design-tokens/);
  });

  it("exits 1 on a parse error and prints the line-numbered message", () => {
    const dir = mkdtempSync(join(tmpdir(), "design-cli-bad-"));
    const input = join(dir, "design.md");
    const output = join(dir, "tokens.css");
    writeFileSync(input, "# Brand\nname: X\n");
    const result = runCli([input, output]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/design.md:\d+:/);
  });
});
