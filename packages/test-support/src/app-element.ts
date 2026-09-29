import HTMLElementConfig from "happy-dom/lib/config/HTMLElementConfig.js";
import HTMLElementConfigContentModelEnum from "happy-dom/lib/config/HTMLElementConfigContentModelEnum.js";

/**
 * Teaches happy-dom the engine's `<app>`.
 *
 * The fork defines `<app>` (an `HTMLAppElement : HTMLElement`); happy-dom
 * knows no such tag and makes an `HTMLUnknownElement`, which React reads as a
 * misspelled component and warns about on the first `<app>` a test renders.
 * `customElements.define` cannot take a name without a hyphen — the reason
 * the element is the engine's — and happy-dom has no public way to add a tag,
 * so it goes in happy-dom's own table of HTML elements, as a plain
 * `HTMLElement` the way `<section>` is.
 */
export const registerAppElement = () => {
  HTMLElementConfig.app = {
    className: "HTMLElement",
    contentModel: HTMLElementConfigContentModelEnum.anyDescendants,
  };
};
