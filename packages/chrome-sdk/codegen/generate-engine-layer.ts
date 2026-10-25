// Bundles `src/desktop/layer.ts` into the engine as `domicile_layer.js`, the
// script the engine evaluates to build the `Domicile` it hands a shell's
// `Shell`, and the `AppDomicile` it hands an app's `main`.
//
//   bun run generate              # in packages/chrome-sdk
//   bun codegen/generate-engine-layer.ts <path>   # somewhere else
//
// `scripts/test-engine-layer-is-the-sdks.sh` checks the file is current.

import { writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const ENTRY = path.join(ROOT, "packages/chrome-sdk/src/desktop/layer.ts");
const TARGET = path.join(
  ROOT,
  "packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/domicile_layer.js",
);

const HEADER = [
  "// Copyright 2026 Connor Prussin",
  "// SPDX-License-Identifier: MIT",
  "//",
  "// Generated from `packages/chrome-sdk/src/desktop/layer.ts` by",
  "// `codegen/generate-engine-layer.ts`. Do not edit: change the SDK and run",
  "// `bun run generate` in `packages/chrome-sdk`.",
  "//",
  "// One expression: the object `{ appDesktop, desktop }`. DomicileShell and",
  "// DomicileApp evaluate it on each page they run a module in.",
  "",
].join("\n");

/** The bundle's closing `export{a as appDesktop,b as desktop};`. */
const EXPORTS = /export\s*\{([^}]*)\};?\s*$/;

/** `layer.ts`, minified, as one ASCII expression. */
export const engineLayer = async (): Promise<string> => {
  const built = await Bun.build({
    entrypoints: [ENTRY],
    format: "esm",
    minify: true,
    target: "browser",
  });
  const [output] = built.outputs;
  if (!built.success || output === undefined) {
    throw new AggregateError(built.logs, "the layer did not bundle");
  }
  const bundle = await output.text();
  const exported = EXPORTS.exec(bundle);
  if (exported?.[1] === undefined) {
    throw new Error("the layer's bundle does not end in its exports");
  }
  const members = exported[1]
    .split(",")
    .map((binding) => binding.trim().split(/\s+as\s+/))
    .map(([local, name]) => `${name ?? local}:${local}`)
    .join(",");
  const body = bundle.slice(0, exported.index);
  return `${HEADER}(()=>{${ascii(body)}return{${members}};})()\n`;
};

/**
 * `source` with each character past ASCII escaped. The engine reads the file
 * as Latin-1, and `\u` escapes mean the same in strings, regular expressions
 * and identifiers.
 */
const ascii = (source: string): string =>
  // Without the `u` flag each UTF-16 unit matches alone, so a character past
  // the BMP becomes its surrogate pair, which every context reads as one.
  source.replaceAll(
    /[^\0-\x7f]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

if (import.meta.main) {
  writeFileSync(process.argv[2] ?? TARGET, await engineLayer());
}
