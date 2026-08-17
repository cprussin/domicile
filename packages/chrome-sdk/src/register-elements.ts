// Wiring the SDK to a bridge: bind the element context, install the
// document-level input listeners, and define the custom elements.

import { DomicileAppElement } from "./app-element";
import type { BridgeClient } from "./bridge";
import {
  activeBridge,
  bindElementContext,
  focusedApp,
  setFocusedApp,
} from "./element-context";
import { evdevFromCode } from "./input";
import type { Measure } from "./measure";
import type { ObserveResize } from "./observe-resize";
import { DomicileWebviewElement } from "./webview-element";

export const APP_TAG_NAME = "domicile-app";
export const WEBVIEW_TAG_NAME = "domicile-webview";

export type RegisterOptions = {
  /** Injected by tests, whose DOM implementation performs no layout. */
  measure?: Measure;
  /** Injected by tests, whose `ResizeObserver` therefore never fires. */
  observeResize?: ObserveResize;
};

let globalInputInstalled = false;

/**
 * Wire the SDK to a bridge and define the custom elements. Idempotent: safe to
 * call once at chrome startup, and safe to call again with a different bridge
 * (which is how tests rebind between cases).
 */
export const registerElements = (
  bridge: BridgeClient,
  { measure, observeResize }: RegisterOptions = {},
): void => {
  bindElementContext(bridge, measure, observeResize);
  installGlobalInput();
  defineElements();
};

// Keyboard events land on the document, not on an element, so they are routed
// to whichever `<domicile-app>` was last clicked. Clicking anywhere else
// returns keyboard focus to the chrome.
const installGlobalInput = (): void => {
  if (!globalInputInstalled && typeof document !== "undefined") {
    globalInputInstalled = true;
    document.addEventListener("keydown", forwardKey);
    document.addEventListener("keyup", forwardKey);
    document.addEventListener("pointerdown", releaseFocusOffApp);
  }
};

const forwardKey = (event: KeyboardEvent): void => {
  const appId = focusedApp();
  const bridge = activeBridge();
  const keycode = evdevFromCode(event.code);
  if (appId !== undefined && bridge !== undefined && keycode !== undefined) {
    event.preventDefault();
    // The browser repeats a held key; Wayland does not. A client synthesises
    // repeat itself from `wl_keyboard.repeat_info`, so forwarding these as
    // fresh presses would give it two repeat sources at once — which it draws
    // as the same character over and over.
    if (!event.repeat) {
      bridge.key(appId, keycode, event.type === "keydown");
    }
  }
};

const releaseFocusOffApp = (event: Event): void => {
  const target = event.target;
  const onApp =
    target instanceof Element && target.closest(APP_TAG_NAME) !== null;
  if (!onApp && focusedApp() !== undefined) {
    setFocusedApp(undefined);
    activeBridge()?.focusChrome();
  }
};

// `customElements` is absent when the SDK is loaded outside a browsing context
// (a unit test of the message layer, say); binding the bridge is still useful
// there, defining the elements is not.
const defineElements = (): void => {
  if (typeof customElements !== "undefined") {
    if (customElements.get(APP_TAG_NAME) === undefined) {
      customElements.define(APP_TAG_NAME, DomicileAppElement);
    }
    if (customElements.get(WEBVIEW_TAG_NAME) === undefined) {
      customElements.define(WEBVIEW_TAG_NAME, DomicileWebviewElement);
    }
  }
};
