// Wiring the SDK to a domicile client: bind the element context and install the
// document-level input routing and size reporting the `<app>` tag needs.
//
// Nothing is registered any more, and the name is kept anyway: it is the one
// call every shell makes, and `<app>` and `<webview>` are the engine's tags —
// `customElements.define` cannot take a name without a hyphen, which is the
// whole reason they are the engine's. What used to be a custom element's
// `connectedCallback`, `attributeChangedCallback` and five listeners per window
// is three document-level installations here.

import type { DomicileClient } from "./domicile-client";
import type { ElementContext } from "./element-context";
import { bindElementContext } from "./element-context";
import { installKeyboardInput } from "./keyboard-input";
import type { Measure } from "./measure";
import type { ObservePlacement } from "./observe-placement";
import { installPointerInput } from "./pointer-input";
import { reportAppSizes } from "./report-app-sizes";

export type RegisterOptions = {
  /** Injected by tests, whose DOM implementation performs no layout. */
  measure?: Measure;
  /** Injected by tests, so a frame happens when the test says rather than as
   * fast as the DOM implementation can serve one. */
  observePlacement?: ObservePlacement;
};

let inputInstalled = false;
let stopReporting: (() => void) | undefined;

/**
 * Wire the SDK to a domicile client.
 *
 * Idempotent: safe to call once at chrome startup, and safe to call again with a
 * different client (which is how tests rebind between cases). The input
 * listeners are installed once — they are on `document`, and they read the
 * context at dispatch, which is one cell a rebind writes through. The size pass
 * is started again, because *which* frame source it follows is part of the bind
 * rather than something it reads per frame.
 */
export const registerElements = (
  domicile: DomicileClient,
  { measure, observePlacement }: RegisterOptions = {},
): void => {
  const context = bindElementContext(domicile, measure, observePlacement);
  // `document` is absent when the SDK is loaded outside a browsing context (a
  // unit test of the message layer, say); binding the client is still useful
  // there, listening for input that cannot arrive is not, and nothing is laid
  // out to have a size.
  if (typeof document !== "undefined") {
    installInput(context);
    stopReporting?.();
    stopReporting = reportAppSizes(context);
  }
};

const installInput = (context: ElementContext): void => {
  if (!inputInstalled) {
    inputInstalled = true;
    installKeyboardInput(context);
    installPointerInput(context);
  }
};
