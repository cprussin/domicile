// A minimal shell: every app is full-screen, with the newest on top.
//
// Domicile calls the `Shell` export with the element to draw `<app>` elements
// in. See /docs/WRITING-A-SHELL.md.

import { connectToHost } from "@domicile-desktop/sdk/connect-to-host";
import { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import { registerElements } from "@domicile-desktop/sdk/register-elements";

/** Draws the desktop into `root`, Domicile's empty `<body>`. */
export const Shell = (root: HTMLElement): void => {
  // In an ordinary browser `connectToHost` returns a stand-in, so the layout
  // can be developed without a compositor.
  const domicile = new DomicileClient(connectToHost(window));
  // Forwards pointer and keyboard input on `<app>` elements to the host.
  registerElements(domicile);

  /** Mounted `<app>` elements by app id. */
  const mounted = new Map<string, HTMLElement>();

  domicile.on("app_appeared", ({ app_id }) => {
    const element = document.createElement("app");
    element.setAttribute("app-id", app_id);
    // The elements share a stacking context, so appending puts it on top.
    root.append(element);
    mounted.set(app_id, element);
  });

  /**
   * Absolute origin of each popup by app id.
   *
   * Popup positions are relative to their parent. Windows start at (0, 0), so
   * a popup's origin is the sum of the offsets up its parent chain.
   */
  const origins = new Map<string, readonly [x: number, y: number]>();

  domicile.on("popup_placed", ({ app_id, parent, position, size }) => {
    const [parentX, parentY] = origins.get(parent) ?? [0, 0];
    const [x, y] = [parentX + position[0], parentY + position[1]];
    origins.set(app_id, [x, y]);
    // A repositioned popup is placed again under the same id.
    const element = mounted.get(app_id) ?? document.createElement("app");
    element.setAttribute("app-id", app_id);
    Object.assign(element.style, {
      height: `${size[1].toString()}px`,
      left: `${x.toString()}px`,
      top: `${y.toString()}px`,
      width: `${size[0].toString()}px`,
    });
    // Appending puts it above its parent.
    root.append(element);
    mounted.set(app_id, element);
  });

  domicile.on("app_closed", ({ app_id }) => {
    origins.delete(app_id);
    const element = mounted.get(app_id);
    if (element === undefined) {
      // The host announces every app before closing it, so this means the
      // shell and compositor disagree about the desktop. Fail loudly rather
      // than continue in an unknown state.
      throw new Error(
        `domicile: closed an app that was never opened: ${app_id}`,
      );
    } else {
      element.remove();
      mounted.delete(app_id);
    }
  });
};
