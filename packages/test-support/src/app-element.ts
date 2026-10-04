import HTMLElementConfig from "happy-dom/lib/config/HTMLElementConfig.js";
import HTMLElementConfigContentModelEnum from "happy-dom/lib/config/HTMLElementConfigContentModelEnum.js";

/**
 * Registers the engine's `<app>` element with happy-dom.
 *
 * Without this, happy-dom creates an `HTMLUnknownElement` and React warns.
 * `customElements.define` rejects names without a hyphen, and happy-dom has
 * no public API for new tags, so this edits happy-dom's internal tag table.
 */
export const registerAppElement = () => {
  HTMLElementConfig.app = {
    className: "HTMLElement",
    contentModel: HTMLElementConfigContentModelEnum.anyDescendants,
  };
};
