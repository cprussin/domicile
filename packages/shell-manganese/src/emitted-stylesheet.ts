// For tests only: nothing the shell ships imports this.

import { readFileSync } from "node:fs";

/**
 * Put the stylesheet Panda emitted for this shell on `document`, so a test can
 * ask what an element's style *resolves* to.
 *
 * What a box resolves to is decided by the emitted stylesheet, not by any one
 * `css(...)` call: Panda's atomic classes all carry the same specificity, so a
 * declaration survives only if nothing later in the bundle declares one for
 * the same element, and the global rules in `panda.config.ts` are in no
 * `css(...)` call at all. Loading the real sheet is what makes either
 * observable.
 *
 * The layers come off first: happy-dom drops `@layer` blocks whole, and Panda
 * emits everything inside them. `@media all` keeps the braces balanced and
 * matches unconditionally, and the layers are emitted weakest-first, so plain
 * source order lands on the same winner the cascade would.
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
