// Test-only.

import { readFileSync } from "node:fs";

/**
 * Adds the shell's emitted Panda stylesheet to `document`, so tests can check
 * resolved styles.
 *
 * Needed because atomic classes share specificity, so the bundle order decides
 * the winner, and the global rules in `panda.config.ts` are in no `css()` call.
 *
 * happy-dom drops `@layer` blocks, so they become `@media all`. Panda emits
 * layers weakest first, so source order gives the same result as the cascade.
 */
export const loadEmittedStylesheet = (document: Document): void => {
  const stylesheet = document.createElement("style");
  stylesheet.textContent = readFileSync(
    new URL("../styled-system/styles.css", import.meta.url),
    "utf8",
  )
    .replaceAll(/@layer [^;{]+;/g, "")
    .replaceAll(/@layer [^{]+\{/g, "@media all{");
  document.head.append(stylesheet);
};
