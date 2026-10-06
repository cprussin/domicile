// Connects the SDK to `window.domicile`: binds the element context and
// installs the document-level input routing for `<app>` elements.
//
// The engine defines `<app>` and `<webview>`, so no custom elements are
// registered here.

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
 * Wire the SDK to `window.domicile`.
 *
 * Safe to call again with a different host. Input listeners are installed
 * once and read the current context at dispatch.
 */
export const registerElements = (
  domicile: InputHost,
  { measure }: RegisterOptions = {},
): void => {
  const context = bindElementContext(domicile, measure);
  // Follow the compositor's keyboard focus, not only the page's requests: the
  // compositor also moves focus itself, and keys forwarded to a client that
  // lost it are lost. Only while this host is bound; a rebind leaves the old
  // listener behind.
  domicile.addEventListener("focusedwindowchanged", () => {
    if (context.domicile === domicile) {
      setFocusedApp(domicile.focusedWindow ?? undefined);
    }
  });
  // `document` is absent outside a browser, such as in unit tests.
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
