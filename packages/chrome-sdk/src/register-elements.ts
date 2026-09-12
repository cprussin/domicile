// Wiring the SDK to a domicile client: bind the element context, install the
// document-level input listeners, and define the custom element.

import { createAppElement } from "./app-element";
import type { DomicileClient } from "./domicile-client";
import type { ElementContext } from "./element-context";
import {
  bindElementContext,
  focusedApp,
  setFocusedApp,
} from "./element-context";
import { evdevFromCode } from "./input";
import type { Measure } from "./measure";
import type { ObservePlacement } from "./observe-placement";

export const APP_TAG_NAME = "domicile-app";

export type RegisterOptions = {
  /** Injected by tests, whose DOM implementation performs no layout. */
  measure?: Measure;
  /** Injected by tests, so a frame happens when the test says rather than as
   * fast as the DOM implementation can serve one. */
  observePlacement?: ObservePlacement;
};

let globalInputInstalled = false;

/**
 * Wire the SDK to a domicile client and define the custom element.
 * Idempotent: safe to call once at chrome startup, and safe to call again with
 * a different client (which is how tests rebind between cases).
 */
export const registerElements = (
  domicile: DomicileClient,
  { measure, observePlacement }: RegisterOptions = {},
): void => {
  const context = bindElementContext(domicile, measure, observePlacement);
  installGlobalInput(context);
  defineAppElement(context);
};

// Keyboard events land on the document, not on an element, so they are routed
// to whichever `<domicile-app>` was last clicked. Clicking anywhere else
// returns keyboard focus to the chrome.
const installGlobalInput = (context: ElementContext): void => {
  if (!globalInputInstalled && typeof document !== "undefined") {
    globalInputInstalled = true;
    const releaseHeld = releaseHeldKeys(context);
    document.addEventListener("keydown", forwardPress(context));
    document.addEventListener("keyup", forwardRelease(context));
    document.addEventListener("pointerdown", releaseFocusOffApp(context));
    // A page that has lost the keyboard — or is going away — is never told the
    // key came up. `pagehide` as well as `blur` because a reload is not a
    // focus change, and it is the event a navigation fires reliably.
    window.addEventListener("blur", releaseHeld);
    window.addEventListener("pagehide", releaseHeld);
  }
};

// The app each forwarded press was sent for, until the key comes up.
//
// A release has to be sent for every press, wherever the keyboard has moved
// in between — the compositor's keyboard state is one seat's, it outlives
// every window, and a press it never sees released stays down in it for good.
// A lock key is where that is fatal rather than untidy: xkb unlocks one only
// on the release of the press that locked it, so under `caps:swapescape` —
// where the physical Escape key *is* Caps_Lock — a dropped release latches
// capitals into every Wayland client, the ones opened afterwards included,
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

const forwardPress =
  (context: ElementContext) =>
  (event: KeyboardEvent): void => {
    const appId = focusedApp();
    const keycode = evdevFromCode(event.code);
    if (appId !== undefined && keycode !== undefined) {
      event.preventDefault();
      // The browser repeats a held key; Wayland does not. A client synthesises
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
    const onApp =
      target instanceof Element && target.closest(APP_TAG_NAME) !== null;
    if (!onApp && focusedApp() !== undefined) {
      setFocusedApp(undefined);
      context.domicile.focusChrome();
    }
  };

// `customElements` is absent when the SDK is loaded outside a browsing context
// (a unit test of the message layer, say); binding the client is still useful
// there, defining the element is not.
//
// The app element is built here, against the context, because that is what
// lets it hold a client it cannot doubt. A second call with a different client
// does not build it again — a tag name can only be defined once — and does not
// need to: the context is one cell, and rebinding writes through it to the
// class already registered.
const defineAppElement = (context: ElementContext): void => {
  if (
    typeof customElements !== "undefined" &&
    customElements.get(APP_TAG_NAME) === undefined
  ) {
    customElements.define(APP_TAG_NAME, createAppElement(context));
  }
};
