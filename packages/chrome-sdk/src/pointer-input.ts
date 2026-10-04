// Forwards pointer events over an `<app>` to its Wayland client.
//
// Listeners are delegated from `document` because `<app>` is an engine tag
// with no SDK class to attach them to. Each handler finds the window with
// `closest(APP_TAG_NAME)` and ignores events outside any window.
//
// Because the listeners are on `document`, a shell that calls
// `stopPropagation()` on a bubbling pointer event also stops the forward.

import type { AppFocusRequest } from "./app-element";
import { APP_FOCUS_REQUESTED_EVENT, APP_TAG_NAME } from "./app-element";
import type { ElementContext } from "./element-context";
import { focusApp } from "./focus-app";
import { buttonCodeFromJs } from "./input";
import { surfaceLocal } from "./surface-coordinates";
import { axisFromWheel } from "./wheel-axis";

/**
 * Surface size for a client that has not drawn yet, so coordinates map 1:1
 * to its box. See {@link surfaceLocal}.
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

  // Suppress Chromium's context menu over a window: the client draws its own
  // menu for the right-click. Only the default action is prevented, so a
  // shell's own `contextmenu` handler still runs elsewhere. `<webview>` guests
  // keep the browser menu; their events never reach this document.
  document.addEventListener("contextmenu", (event) => {
    forApp(event, () => {
      event.preventDefault();
    });
  });

  // `pointerout`, because `pointerleave` does not bubble and cannot be
  // delegated. An `<app>` has no rendered children, so the two behave the
  // same. It fires before `pointermove` on the next window, so leave precedes
  // enter.
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
 * Calls `forward` with the `<app>` containing the event target and its app id.
 *
 * Does nothing outside an `<app>` or for one without an `app-id`. Reads the
 * attribute because stock Chromium's `HTMLUnknownElement` has no `appId`.
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
 * Focuses the clicked window unless the shell cancels
 * {@link APP_FOCUS_REQUESTED_EVENT}.
 *
 * Dispatched on the element so per-window listeners receive it.
 */
const requestFocus = (
  context: ElementContext,
  element: HTMLAppElement,
  pressed: string,
): void => {
  // Focus a popup's window, not the popup: see `DomicileClient.windowOf`.
  const appId = context.domicile.windowOf(pressed);
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
 * Forwards the pointer position in the client's surface pixels.
 *
 * Inverts the element's full element->screen affine rather than its bounding
 * box (see `defaultMeasure` for limits).
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
