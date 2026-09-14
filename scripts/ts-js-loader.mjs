/**
 * Remaps relative `*.js` specifiers to `*.ts` when that file exists so
 * `node --experimental-strip-types` can load platform TypeScript that
 * follows the NodeNext `.js` import convention.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (
    context.parentURL &&
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    specifier.endsWith(".js")
  ) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const tsPath = join(parentDir, specifier.slice(0, -3) + ".ts");
    if (existsSync(tsPath)) {
      return { shortCircuit: true, url: pathToFileURL(tsPath).href };
    }
  }
  return nextResolve(specifier, context);
}
