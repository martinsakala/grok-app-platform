#!/usr/bin/env node
/**
 * Reads a design.md file and writes --pf-* CSS.
 * Run with: node --experimental-strip-types scripts/generate-design-tokens.mjs <design.md> <out.css>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve } from "node:path";

register("./ts-js-loader.mjs", import.meta.url);

const usage = "usage: generate-design-tokens.mjs <design.md> <out.css>";
const inFile = process.argv[2];
const outFile = process.argv[3];
if (!inFile || !outFile) {
  console.error(usage);
  process.exit(2);
}

const { parseDesignMd } = await import(new URL("../src/design/parse.ts", import.meta.url).href);
const { generateTokensCss } = await import(new URL("../src/design/tokens.ts", import.meta.url).href);

try {
  const markdown = readFileSync(resolve(inFile), "utf8");
  const spec = parseDesignMd(markdown);
  const css = generateTokensCss(spec);
  const dest = resolve(outFile);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, css, "utf8");
  console.log(`Wrote ${dest}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
