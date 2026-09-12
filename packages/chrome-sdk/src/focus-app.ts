// Putting the keyboard on a client's window.

import type { DomicileClient } from "./domicile-client";
import { setFocusedApp } from "./element-context";

/**
 * Route the keyboard to the client `appId`.
 *
 * **This rather than `domicile.focusApp(appId)`**, which asks the compositor and
 * stops there. Keyboard events are delivered to the page's `document` rather
 * than to any element — a Wayland client is a surface, not a browsing
 * context — so the SDK has to be told which window they belong to as well, and
 * that is the half this adds. A shell that called the client's method directly
 * would move the compositor's seat and leave every keystroke going to the page.
 *
 * Clicking a window does this too; a shell calls it when it puts a window on
 * screen without a click — opening it, or switching to its tab.
 *
 * Only ever in that direction. Which client holds the keyboard is one seat's
 * answer and something is always in it: "this window has it" is an instruction
 * the compositor can carry out, and "this window does not" is not one. The
 * keyboard leaves a window when another takes it or when a click lands on the
 * chrome, both of which say where it went.
 */
export const focusApp = (domicile: DomicileClient, appId: string): void => {
  setFocusedApp(appId);
  domicile.focusApp(appId);
};
