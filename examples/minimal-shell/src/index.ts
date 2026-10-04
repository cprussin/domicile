// The page, and the whole of this shell's behavior.
//
// A shell is a module whose `Shell` export Domicile calls with the element to
// draw in, and what it draws is `<app>` elements. Where they are and how big
// they are is the shell's entire job — this one puts every app full-screen with
// the newest on top, which is the least a shell can do and still be one.
// Everything else a desktop has is CSS and event handlers on top of exactly
// this.

import type { DomicileWindow } from "@domicile-desktop/sdk/domicile-host";
import { registerElements } from "@domicile-desktop/sdk/register-elements";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

/** The desktop, drawn into `root`: Domicile's empty `<body>`. */
export const Shell: ShellModule = (root, domicile) => {
  // `<app>` is the engine's tag and needs no defining, but the pointer and
  // keyboard over one are the page's to forward, and until this runs nothing
  // does.
  registerElements(domicile);

  /** Every window on the page, by the id the engine lists it under. */
  const mounted = new Map<string, HTMLElement>();

  /** Make the page show what `domicile.windows` lists, in its order. */
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
        // Appending is what puts it on top: the elements are absolutely
        // positioned and share a stacking context, so document order is the
        // stack. Only once: an `<app>` moved in the tree is embedded anew.
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
};

/**
 * Put a popup — a client's menu or tooltip — at its offset from what it is
 * over. Every window here fills the screen, so a window's box starts at the
 * corner and a popup's is its offsets added up to one.
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

/** Where `window`'s box starts: its offsets, added up to a toplevel. */
const originOf = (
  window: DomicileWindow,
  windows: readonly DomicileWindow[],
): readonly [x: number, y: number] => {
  const parent = windows.find((candidate) => candidate.appId === window.parent);
  const [x, y] = parent === undefined ? [0, 0] : originOf(parent, windows);
  return [x + (window.x ?? 0), y + (window.y ?? 0)];
};
