// Taking the keyboard back to the page.

import type { DomicileClient } from "./domicile-client";
import { setFocusedApp } from "./element-context";

/**
 * Route the keyboard back to the chrome's own page.
 *
 * **This rather than `domicile.focusChrome()`**, for the reason `focusApp` is
 * not `domicile.focusApp` either: the client's method moves the compositor's
 * seat and stops there, while this also tells the SDK that the page's
 * keystrokes are the page's again. A shell that called only the first would
 * have the compositor delivering keys to this document and this document
 * forwarding every one of them to the client that used to hold them — which
 * is a desktop whose windows have been left, and are still being typed into.
 *
 * **Most shells never need it.** The keyboard goes back to the page on its own
 * when a click lands on the chrome, and a shell whose windows are the only
 * thing on screen has nothing else to say. What this is for is the third case:
 * a panel the shell itself puts up over the windows — a launcher, a switcher,
 * a palette — which is a thing to type into that no click reached and no
 * client knows about. See `shell-manganese`'s `AppWindow`, which gives the
 * seat up here and asks for it back when the panel goes down.
 */
export const focusChrome = (domicile: DomicileClient): void => {
  setFocusedApp(undefined);
  domicile.focusChrome();
};
