import { afterAll, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Adds a package's emitted Panda stylesheet, read from `stylesheet`, to
 * `document` for the tests of the enclosing `describe` or file, so they can
 * check resolved styles.
 *
 * Needed because atomic classes share specificity, so the bundle order decides
 * the winner, and a config's global rules are in no `css()` call.
 *
 * happy-dom drops `@layer` blocks, so they become `@media all`. Panda emits
 * layers weakest first, so source order gives the same result as the cascade.
 *
 * It is removed after them because test files share one document: every
 * stylesheet left in it slows each later file's style lookups.
 */
export const loadEmittedStylesheet = (
  document: Document,
  stylesheet: URL,
): void => {
  const element = document.createElement("style");
  element.textContent = readFileSync(stylesheet, "utf8")
    .replaceAll(/@layer [^;{]+;/g, "")
    .replaceAll(/@layer [^{]+\{/g, "@media all{");
  beforeAll(() => {
    document.head.append(element);
  });
  afterAll(() => {
    element.remove();
  });
};
