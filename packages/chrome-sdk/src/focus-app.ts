// Gives keyboard focus to a client's window.

import type { InputHost } from "./element-context";
import { setFocusedApp } from "./element-context";

/**
 * Route the keyboard to the client `appId`.
 *
 * Use this instead of `domicile.focusApp(appId)`, which only moves the
 * compositor's seat. Keyboard events arrive at the page's `document`, so the
 * SDK must also record which window gets them. Clicking a window already does
 * this; call it when showing a window without a click, such as opening it or
 * switching to its tab.
 */
export const focusApp = (domicile: InputHost, appId: string): void => {
  setFocusedApp(appId);
  domicile.focusApp(appId);
};
