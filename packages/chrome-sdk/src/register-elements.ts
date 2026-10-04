// Wiring the SDK to the desktop: bind the element context and install the
// document-level input routing the `<app>` tag needs.
//
// Nothing is registered any more, and the name is kept anyway: it is the one
// call every shell makes, and `<app>` and `<webview>` are the engine's tags —
// `customElements.define` cannot take a name without a hyphen, which is the
// whole reason they are the engine's. What used to be a custom element's
// `connectedCallback`, `attributeChangedCallback` and five listeners per window
// is two document-level installations here.

import type { ElementContext, InputHost } from "./element-context";
import { bindElementContext, setFocusedApp } from "./element-context";
import { installKeyboardInput } from "./keyboard-input";
import type { Measure } from "./measure";
import { installPointerInput } from "./pointer-input";

export type RegisterOptions = {
  /** Injected by tests, whose DOM implementation performs no layout. */
  measure?: Measure;
};

let inputInstalled = false;

/**
 * Wire the SDK to the desktop a shell is handed.
 *
 * Idempotent: safe to call once at chrome startup, and safe to call again with a
 * different host (which is how tests rebind between cases). The input
 * listeners are installed once — they are on `document`, and they read the
 * context at dispatch, which is one cell a rebind writes through.
 */
export const registerElements = (
  domicile: InputHost,
  { measure }: RegisterOptions = {},
): void => {
  const context = bindElementContext(domicile, measure);
  // The keys this page forwards go where the compositor says the keyboard is,
  // and not only where the page last asked for it: the compositor moves it on
  // its own too, and a page that heard only its own requests went on
  // forwarding every key to a client that no longer had it -- which is a
  // launcher's box, focused and empty under every letter. Only while this host
  // is the bound one: a rebind leaves the old listener behind.
  domicile.addEventListener("focusedwindowchanged", () => {
    if (context.domicile === domicile) {
      setFocusedApp(domicile.focusedWindow ?? undefined);
    }
  });
  // `document` is absent when the SDK is loaded outside a browsing context (a
  // unit test of the message layer, say); binding the client is still useful
  // there, and listening for input that cannot arrive is not.
  if (typeof document !== "undefined") {
    installInput(context);
  }
};

const installInput = (context: ElementContext): void => {
  if (!inputInstalled) {
    inputInstalled = true;
    installKeyboardInput(context);
    installPointerInput(context);
  }
};
