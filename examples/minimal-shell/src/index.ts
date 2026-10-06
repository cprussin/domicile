// A minimal shell: every app is full-screen, with the newest on top.
//
// Domicile calls the `Shell` export with the element to draw `<app>` elements
// in. See /docs/WRITING-A-SHELL.md.

import type { DomicileWindow } from "@domicile-desktop/sdk/domicile-host";
import {
  answerPortalRequest,
  PortalAnswer,
  watchPortalRequests,
} from "@domicile-desktop/sdk/portal";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

/** Draws the desktop into `root`, Domicile's empty `<body>`. */
export const Shell: ShellModule = (root, domicile) => {
  // `<app>` is the engine's tag; the engine sends the pointer and keyboard
  // over one to its client.

  /** Mounted `<app>` elements by app id. */
  const mounted = new Map<string, HTMLElement>();

  /** Shows what `domicile.windows` lists, in its order. */
  const show = () => {
    const windows = domicile.windows;
    for (const [appId, element] of mounted) {
      if (!windows.some((window) => window.appId === appId)) {
        element.remove();
        mounted.delete(appId);
      }
    }
    for (const window of windows) {
      let element = mounted.get(window.appId);
      if (element === undefined) {
        element = document.createElement("app");
        element.setAttribute("app-id", window.appId);
        // The elements share a stacking context, so appending puts it on top.
        // Append only once: moving an `<app>` in the tree embeds it again.
        root.append(element);
        mounted.set(window.appId, element);
      }
      if (window.parent !== null) {
        placePopup(element, window, windows);
      }
    }
  };

  show();
  domicile.addEventListener("windowschanged", show);

  // This shell draws no dialogs, so it refuses what applications ask through
  // the desktop portal rather than leave them waiting. A React shell mounts
  // `PortalDialogs` from `@domicile-desktop/component-library` instead.
  watchPortalRequests(domicile, (requests) => {
    for (const request of requests) {
      answerPortalRequest(domicile, request.id, PortalAnswer.Refused());
    }
  });
};

/**
 * Places a popup (a menu or tooltip). Popup positions are relative to their
 * parent and windows start at (0, 0), so a popup's origin is the sum of the
 * offsets up its parent chain.
 */
const placePopup = (
  element: HTMLElement,
  popup: DomicileWindow,
  windows: readonly DomicileWindow[],
): void => {
  const [x, y] = originOf(popup, windows);
  Object.assign(element.style, {
    height: `${(popup.height ?? 0).toString()}px`,
    left: `${x.toString()}px`,
    top: `${y.toString()}px`,
    width: `${(popup.width ?? 0).toString()}px`,
  });
};

/** The absolute origin of `window`'s box. */
const originOf = (
  window: DomicileWindow,
  windows: readonly DomicileWindow[],
): readonly [x: number, y: number] => {
  const parent = windows.find((candidate) => candidate.appId === window.parent);
  const [x, y] = parent === undefined ? [0, 0] : originOf(parent, windows);
  return [x + (window.x ?? 0), y + (window.y ?? 0)];
};
