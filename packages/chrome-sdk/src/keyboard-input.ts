// Keyboard input, which is the page's and has to be told whose it is.
//
// A key event is delivered to `document` and never to an element: a Wayland
// client is a surface rather than a browsing context, so there is nothing for
// the browser to give focus to. The SDK routes them to whichever window was last
// reached for — a click, or a `focusApp` — and a click anywhere else hands the
// keyboard back to the chrome, unless the shell says that click was for a
// window after all: see `releaseAllowed`.

import type { AppFocusReleaseRequest } from "./app-element";
import { APP_FOCUS_RELEASE_REQUESTED_EVENT, APP_TAG_NAME } from "./app-element";
import type { ElementContext } from "./element-context";
import { focusedApp, setFocusedApp } from "./element-context";
import { evdevFromCode } from "./input";
import type { KeyPress } from "./shortcut-claims";
import { isClaimed } from "./shortcut-claims";

// The app each forwarded press was sent for, until the key comes up.
//
// A release has to be sent for every press, wherever the keyboard has moved
// in between — the compositor's keyboard state is one seat's, it outlives
// every window, and a press it never sees released stays down in it for good.
// A lock key is where that is fatal rather than untidy: xkb unlocks one only
// on the release of the press that locked it, so under `caps:swapescape` —
// where the physical Escape key *is* Caps_Lock — a dropped release latches
// capitals into every Wayland client, the ones opened afterward included,
// and no later press of that key can clear it. The chrome's own webviews
// never touch that state, so they keep typing normally, which is what makes
// the failure look like it belongs to the terminals.
//
// The app id is what the message carries rather than where the release goes:
// the compositor injects a key into the seat and lets the focus it already
// has deliver it. What protects the client that took the press is
// `wl_keyboard.leave`, which tells it every key is up — so naming the app the
// press was sent for is simply the truthful value for the field.
const heldKeys = new Map<number, string>();

/** Route the page's keystrokes to whichever window the user reached for. */
export const installKeyboardInput = (context: ElementContext): void => {
  const releaseHeld = releaseHeldKeys(context);
  document.addEventListener("keydown", forwardPress(context));
  document.addEventListener("keyup", forwardRelease(context));
  document.addEventListener("pointerdown", releaseFocusOffApp(context));
  // A page that has lost the keyboard — or is going away — is never told the
  // key came up. `pagehide` as well as `blur` because a reload is not a focus
  // change, and it is the event a navigation fires reliably.
  window.addEventListener("blur", releaseHeld);
  window.addEventListener("pagehide", releaseHeld);
};

const forwardPress =
  (context: ElementContext) =>
  (event: KeyboardEvent): void => {
    const appId = keyboardTarget(context);
    const keycode = evdevFromCode(event.code);
    // A combination the desktop claimed is not the window's, wherever the
    // keyboard is pointed: the page is where it is answered, and forwarding it
    // as well is the window acting on a key the shell already spent. The
    // release is not forwarded either, because it was never taken down as held.
    if (
      appId !== undefined &&
      keycode !== undefined &&
      !isClaimed(press(event, keycode))
    ) {
      event.preventDefault();
      // The browser repeats a held key; Wayland does not. A client synthesizes
      // repeat itself from `wl_keyboard.repeat_info`, so forwarding these as
      // fresh presses would give it two repeat sources at once — which it
      // draws as the same character over and over.
      if (!event.repeat) {
        heldKeys.set(keycode, appId);
        context.domicile.key(appId, keycode, true);
      }
    }
  };

const forwardRelease =
  (context: ElementContext) =>
  (event: KeyboardEvent): void => {
    const keycode = evdevFromCode(event.code);
    if (keycode !== undefined) {
      const appId = heldKeys.get(keycode);
      if (appId !== undefined) {
        event.preventDefault();
        heldKeys.delete(keycode);
        // Whatever is bound now, rather than what took the press: the context
        // is one cell that a rebind writes through, and what the release is
        // for is the compositor's seat — this is the connection to it.
        context.domicile.key(appId, keycode, false);
      }
    }
  };

// Every key still down, released. Called when the page stops hearing the
// keyboard at all, which is the one case where the releases are not merely
// going somewhere else — they are never coming.
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
      setFocusedApp(undefined);
      context.domicile.focusChrome();
    }
  };

/**
 * Whether the window `appId` is to give the keyboard up for this press.
 *
 * The shell's to answer, because the SDK cannot: a press that landed off every
 * `<app>` landed on the page, and nothing in it says whether that page was the
 * desktop behind the windows or the title bar of the window being asked about.
 * Left unanswered — a shell with no chrome of its own, which is most of
 * them — it is a yes, so this changes nothing for a shell that has never heard
 * of the event.
 *
 * A window whose element has left the page is not asked and not kept: there is
 * nothing to dispatch on, and a keyboard held for a window that is gone is the
 * desktop that stopped listening {@link keyboardTarget} exists to prevent.
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
 * Which client a press belongs to, or `undefined` for the chrome's own page.
 *
 * The window the keyboard was routed to can leave the page without the SDK
 * hearing: a shell takes an element down when its client closes, and with the
 * tag the engine's there is no `disconnectedCallback` to notice it in. Left
 * alone, every keystroke after a window closes is taken from the page — the
 * forward calls `preventDefault()` — and sent to a client that is gone, which is
 * a desktop that works right up until you close a window.
 *
 * Asked here rather than pushed from the host's `app_closed`, because this is the
 * one place the answer is used and `DomicileClient.on` is a single slot the
 * shell's own handler wants. It costs one walk of the windows per keystroke,
 * against a socket write on the same path.
 *
 * The repair is not only local: the compositor's seat still points at the client
 * that went, so the chrome says the keyboard is its again. That is the truthful
 * thing to say — the page is where a closed client's keyboard goes — and the
 * alternative is a desktop that has stopped listening.
 */
const keyboardTarget = (context: ElementContext): string | undefined => {
  const appId = focusedApp();
  if (appId !== undefined && !onPage(appId)) {
    setFocusedApp(undefined);
    context.domicile.focusChrome();
    return undefined;
  } else {
    return appId;
  }
};

/** Whether a window for `appId` is still in the document. */
const onPage = (appId: string): boolean => appElement(appId) !== undefined;

/**
 * The `<app>` showing `appId`, or `undefined` when none is on the page.
 *
 * Read off the attribute rather than the `appId` property, for the reason the
 * rest of the delegation does: a shell running on stock Chromium gets an
 * `HTMLUnknownElement` with none of the fork's properties on it.
 */
const appElement = (appId: string): Element | undefined =>
  [...document.querySelectorAll(APP_TAG_NAME)].find(
    (element) => element.getAttribute("app-id") === appId,
  );

/** The press, in the terms a claim is written in. */
const press = (event: KeyboardEvent, keycode: number): KeyPress => ({
  altKey: event.altKey,
  ctrlKey: event.ctrlKey,
  keycode,
  metaKey: event.metaKey,
  shiftKey: event.shiftKey,
});
