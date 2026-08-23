import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";

// The SDK's custom element, as the DOM's own tag-name map knows it. This chrome
// builds its DOM by hand rather than through a framework, so
// `document.createElement("domicile-app")` is where the element's type has to
// come from — without this it would come back as a bare `HTMLElement` and every
// call the SDK defines would need a cast.

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging into HTMLElementTagNameMap requires an interface
  interface HTMLElementTagNameMap {
    "domicile-app": DomicileAppElement;
  }
}
