import { readFileSync } from "node:fs";

/**
 * Adds a package's emitted Panda stylesheet, read from `stylesheet`, to
 * `document`, so tests can check resolved styles.
 *
 * Needed because atomic classes share specificity, so the bundle order decides
 * the winner, and a config's global rules are in no `css()` call.
 *
 * happy-dom drops `@layer` blocks, so they become `@media all`. Panda emits
 * layers weakest first, so source order gives the same result as the cascade.
 */
export const loadEmittedStylesheet = (
  document: Document,
  stylesheet: URL,
): void => {
  const element = document.createElement("style");
  element.textContent = readFileSync(stylesheet, "utf8")
    .replaceAll(/@layer [^;{]+;/g, "")
    .replaceAll(/@layer [^{]+\{/g, "@media all{");
  document.head.append(element);
};
