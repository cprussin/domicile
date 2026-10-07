import HTMLElementConfig from "happy-dom/lib/config/HTMLElementConfig.js";
import HTMLElementConfigContentModelEnum from "happy-dom/lib/config/HTMLElementConfigContentModelEnum.js";

/**
 * Registers HTML's `<search>` element with happy-dom.
 *
 * Chromium supports `<search>`; happy-dom does not, so it creates an
 * `HTMLUnknownElement` and React warns. See `app-element.ts` for why this
 * edits happy-dom's internal tag table.
 */
export const registerSearchElement = () => {
  HTMLElementConfig.search = {
    className: "HTMLElement",
    contentModel: HTMLElementConfigContentModelEnum.anyDescendants,
  };
};
