// Forwards the page's key events to the focused Wayland window.
//
// Key events reach `document`, never an `<app>`, since a Wayland surface
// cannot take browser focus. The SDK forwards them to the window last clicked
// or passed to `focusApp`. A click elsewhere returns focus to the chrome
// unless the shell objects (see `releaseAllowed`).

import type { AppFocusReleaseRequest } from "./app-element";
import { APP_FOCUS_RELEASE_REQUESTED_EVENT, APP_TAG_NAME } from "./app-element";
import type { ElementContext } from "./element-context";
import { focusedApp } from "./element-context";
import { focusChrome } from "./focus-chrome";
import { evdevFromCode } from "./input";

// The app each forwarded press went to, until its key is released.
//
// Every forwarded press needs a release, even if focus has moved. The seat's
// key state outlives windows, so a lost release leaves the key stuck for all
// clients. With a lock key (e.g. Caps_Lock under `caps:swapescape`) the stuck
// state cannot be cleared by pressing the key again.
//
// The compositor delivers a release to the seat's current focus; the app id
// is informational.
const heldKeys = new Map<number, string>();

// Keys whose press the engine took as a grabbed chord, until released.
const takenKeys = new Set<number>();

/** Route the page's keystrokes to whichever window the user reached for. */
export const installKeyboardInput = (context: ElementContext): void => {
  const releaseHeld = releaseHeldKeys(context);
  document.addEventListener("keydown", forwardPress(context));
  document.addEventListener("keyup", forwardRelease(context));
  document.addEventListener("pointerdown", releaseFocusOffApp(context));
  // A page that loses focus or unloads never sees the key releases. A reload
  // fires `pagehide` but not `blur`.
  window.addEventListener("blur", releaseHeld);
  window.addEventListener("pagehide", releaseHeld);
  document.addEventListener("focusin", releaseIntoGuest(releaseHeld));
};

// A key released inside a focused `<webview>` never reaches this document, so
// release held keys when a guest takes focus. Otherwise a Super held while
// switching to a browser window stays stuck in the seat.
const releaseIntoGuest =
  (releaseHeld: () => void) =>
  (event: FocusEvent): void => {
    if (
      event.target instanceof Element &&
      event.target.localName === "webview"
    ) {
      releaseHeld();
    }
  };

const forwardPress =
  (context: ElementContext) =>
  (event: KeyboardEvent): void => {
    const appId = keyboardTarget(context);
    const keycode = evdevFromCode(event.code);
    // The engine took a chord grabbed by name and sends it as `shortcut`, so
    // do not forward it. Its release is skipped too.
    if (event.defaultPrevented && keycode !== undefined) {
      takenKeys.add(keycode);
      return;
    }
    if (appId !== undefined && keycode !== undefined) {
      event.preventDefault();
      // Wayland clients generate key repeat themselves, so forwarding the
      // browser's repeats would double it.
      if (!event.repeat) {
        heldKeys.set(keycode, appId);
        context.domicile.key(appId, keycode, true);
      }
    }
  };

// Forwards every release, not only those for forwarded presses: a key held
// across a page reload is released on a page that never saw the press. The
// compositor ignores releases for keys the seat does not hold, so this is
// safe. Chords the engine took (`takenKeys`) are skipped, as in
// `forwardPress`.
const forwardRelease =
  (context: ElementContext) =>
  (event: KeyboardEvent): void => {
    const keycode = evdevFromCode(event.code);
    if (keycode !== undefined && takenKeys.delete(keycode)) {
      return;
    }
    if (keycode !== undefined) {
      const held = heldKeys.get(keycode);
      if (held !== undefined) {
        event.preventDefault();
        heldKeys.delete(keycode);
      }
      // The compositor ignores the app id; send the best one available.
      context.domicile.key(held ?? focusedApp() ?? "", keycode, false);
    }
  };

// Releases every held key. Called when the page will not see the releases.
const releaseHeldKeys = (context: ElementContext) => (): void => {
  for (const [keycode, appId] of heldKeys) {
    context.domicile.key(appId, keycode, false);
  }
  heldKeys.clear();
};

const releaseFocusOffApp =
  (context: ElementContext) =>
  (event: Event): void => {
    const target = event.target;
    const pressed = target instanceof Element ? target : undefined;
    const onApp = pressed?.closest(APP_TAG_NAME) ?? null;
    const appId = focusedApp();
    if (
      onApp === null &&
      appId !== undefined &&
      releaseAllowed(appId, pressed)
    ) {
      focusChrome(context.domicile);
    }
  };

/**
 * Whether window `appId` should lose focus for a press outside every `<app>`.
 *
 * The shell decides by canceling `APP_FOCUS_RELEASE_REQUESTED_EVENT` (e.g. for
 * a click on the window's title bar). Defaults to yes. A window whose element
 * is gone always releases.
 */
const releaseAllowed = (
  appId: string,
  pressed: Element | undefined,
): boolean => {
  const element = appElement(appId);
  return (
    element === undefined ||
    element.dispatchEvent(
      new CustomEvent<AppFocusReleaseRequest>(
        APP_FOCUS_RELEASE_REQUESTED_EVENT,
        { bubbles: true, cancelable: true, detail: { appId, pressed } },
      ),
    )
  );
};

/**
 * The app a press goes to, or `undefined` for the chrome.
 *
 * If the focused window's element has left the page, focus returns to the
 * chrome. Otherwise keys would go to a closed client and the page would never
 * get them. The SDK cannot observe element removal (no
 * `disconnectedCallback`), so this checks on each press.
 */
const keyboardTarget = (context: ElementContext): string | undefined => {
  const appId = focusedApp();
  if (appId !== undefined && !onPage(appId)) {
    focusChrome(context.domicile);
    return undefined;
  } else {
    return appId;
  }
};

/** Whether a window for `appId` is still in the document. */
const onPage = (appId: string): boolean => appElement(appId) !== undefined;

/**
 * The `<app>` showing `appId`, or `undefined` if none.
 *
 * Reads the attribute, not the `appId` property, because stock Chromium makes
 * `<app>` an `HTMLUnknownElement`.
 */
const appElement = (appId: string): Element | undefined =>
  [...document.querySelectorAll(APP_TAG_NAME)].find(
    (element) => element.getAttribute("app-id") === appId,
  );
