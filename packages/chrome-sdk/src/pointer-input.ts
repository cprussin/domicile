// Pointer input over an `<app>`, which belongs to the client underneath it.
//
// Delegated from `document` rather than bound per element, because the tag is
// the engine's: there is no longer a class with a constructor to install a
// listener in. Every handler asks the same question — `closest(APP_TAG_NAME)` on
// the event's target — and does nothing when the answer is no window, which is
// what a click on the desktop behind them is.
//
// Delegation is not only what is left; it is also one listener per event type
// for a desktop of any size, where the element bound five of its own to every
// window on the page.
//
// What it costs, and it is worth stating because it was free before: a listener
// on `document` is the last to hear a bubbling event, so a shell that listens
// on a container of its own and calls `stopPropagation()` now suppresses the
// forward. The element's own listeners fired first and could not be suppressed
// that way. Nothing in this repository does it — `shell-simple` takes the
// pointer in the *capture* phase, which stops the event before the element ever
// had it, and `shell-manganese` takes it with `pointer-events: none` and a
// sheet over the window — so the two shells are unaffected either way.

import type { AppFocusRequest } from "./app-element";
import { APP_FOCUS_REQUESTED_EVENT, APP_TAG_NAME } from "./app-element";
import type { ElementContext } from "./element-context";
import { focusApp } from "./focus-app";
import { buttonCodeFromJs } from "./input";
import { surfaceLocal } from "./surface-coordinates";
import { axisFromWheel } from "./wheel-axis";

/**
 * The scale a client that has not committed a buffer is mapped through: its
 * own box, 1:1. See {@link surfaceLocal}.
 */
const NOT_DRAWN_YET = [0, 0] as const;

/** Forward every pointer event over an `<app>` to the client behind it. */
export const installPointerInput = (context: ElementContext): void => {
  document.addEventListener("pointermove", (event) => {
    forApp(event, (element, appId) => {
      forwardMotion(context, element, appId, event);
    });
  });

  document.addEventListener("pointerdown", (event) => {
    forApp(event, (element, appId) => {
      requestFocus(context, element, appId);
      forwardMotion(context, element, appId, event);
      const button = buttonCodeFromJs(event.button);
      if (button !== undefined) {
        context.domicile.pointerButton(appId, button, true);
      }
    });
  });

  document.addEventListener("pointerup", (event) => {
    forApp(event, (_element, appId) => {
      const button = buttonCodeFromJs(event.button);
      if (button !== undefined) {
        context.domicile.pointerButton(appId, button, false);
      }
    });
  });

  // `pointerout` rather than `pointerleave`, which does not bubble and so
  // cannot be delegated at all. The two differ only for a pointer moving into a
  // descendant of the element, and an `<app>` is a replaced element: it has no
  // rendered children to move into. Moving from one window straight to another
  // fires this on the first before `pointermove` reaches the second, so the
  // client the pointer left is told before the one it arrived at.
  document.addEventListener("pointerout", (event) => {
    forApp(event, (_element, appId) => {
      context.domicile.pointerLeave(appId);
    });
  });

  document.addEventListener(
    "wheel",
    (event) => {
      forApp(event, (_element, appId) => {
        context.domicile.pointerAxis(appId, axisFromWheel(event));
      });
    },
    { passive: true },
  );
};

/**
 * The window an event landed in, and the client it stands for — or nothing.
 *
 * `closest` rather than a check that the target *is* the element: what a
 * forward needs to know is which window the pointer is over, and that is a
 * question about the tree rather than about the engine's layout choice for the
 * tag. Asking it the narrow way would be the SDK relying on `<app>` being a
 * replaced element, which is not its business to rely on.
 *
 * An element with no `app-id` stands for no client, so there is nothing to
 * forward to. Read off the attribute rather than the reflected `appId` property,
 * which a stock browser's `HTMLUnknownElement` does not have.
 */
const forApp = (
  event: Event,
  forward: (element: HTMLAppElement, appId: string) => void,
): void => {
  const target = event.target;
  const element =
    target instanceof Element ? target.closest(APP_TAG_NAME) : null;
  if (element !== null) {
    const appId = element.getAttribute("app-id");
    if (appId !== null) {
      forward(element, appId);
    }
  }
};

/**
 * A click is the user reaching for this window, and in most shells the keyboard
 * follows it — but *most* is not *every*, and the SDK is in no position to know
 * which this is. So it asks, and focuses only if the shell lets the request
 * stand. See {@link APP_FOCUS_REQUESTED_EVENT}.
 *
 * Dispatched on the element rather than on `document` even though this listener
 * is document-level: it bubbles either way, and a shell that does bind per
 * window should get the event on the window it bound to.
 */
const requestFocus = (
  context: ElementContext,
  element: HTMLAppElement,
  appId: string,
): void => {
  const unanswered = element.dispatchEvent(
    new CustomEvent<AppFocusRequest>(APP_FOCUS_REQUESTED_EVENT, {
      bubbles: true,
      cancelable: true,
      detail: { appId },
    }),
  );
  if (unanswered) {
    focusApp(context.domicile, appId);
  }
};

/**
 * Where the pointer is, in the client's own surface pixels.
 *
 * Motion is the one forward that needs a layout box: without one there is no
 * surface-local coordinate to report, while focus and button state still are
 * meaningful. The element's own element->screen affine inverts back to surface
 * coordinates, so any CSS transform on the element is undone here rather than
 * approximated by its axis-aligned box.
 */
const forwardMotion = (
  context: ElementContext,
  element: HTMLAppElement,
  appId: string,
  event: MouseEvent,
): void => {
  const { size, transform } = context.measure(element);
  const local = surfaceLocal(
    transform,
    size,
    context.domicile.surfaceSizeOf(appId) ?? NOT_DRAWN_YET,
    [event.clientX, event.clientY],
  );
  if (local !== undefined) {
    context.domicile.pointerMotion(appId, local.x, local.y);
  }
};
