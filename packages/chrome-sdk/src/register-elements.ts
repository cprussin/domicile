// Connects the SDK to a domicile client: binds the element context and
// installs the document-level input routing for `<app>` elements.
//
// The engine defines `<app>` and `<webview>`, so no custom elements are
// registered here.

import type { DomicileClient } from "./domicile-client";
import type { ElementContext } from "./element-context";
import { bindElementContext } from "./element-context";
import { installKeyboardInput } from "./keyboard-input";
import type { Measure } from "./measure";
import { installPointerInput } from "./pointer-input";

export type RegisterOptions = {
  /** Injected by tests, whose DOM implementation performs no layout. */
  measure?: Measure;
};

let inputInstalled = false;

/**
 * Wire the SDK to a domicile client.
 *
 * Safe to call again with a different client. Input listeners are installed
 * once and read the current context at dispatch.
 */
export const registerElements = (
  domicile: DomicileClient,
  { measure }: RegisterOptions = {},
): void => {
  const context = bindElementContext(domicile, measure);
  // `document` is absent outside a browser, such as in message-layer tests.
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
