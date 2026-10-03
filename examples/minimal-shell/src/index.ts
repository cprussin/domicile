// The page, and the whole of this shell's behavior.
//
// A shell is a module whose `Shell` export Domicile calls with the element to
// draw in, and what it draws is `<app>` elements. Where they are and how big
// they are is the shell's entire job — this one puts every app full-screen with
// the newest on top, which is the least a shell can do and still be one.
// Everything else a desktop has is CSS and event handlers on top of exactly
// this.

import { connectToHost } from "@domicile-desktop/sdk/connect-to-host";
import { reportDevicePixelRatio } from "@domicile-desktop/sdk/device-pixel-ratio";
import { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import { registerElements } from "@domicile-desktop/sdk/register-elements";

/** The desktop, drawn into `root`: Domicile's empty `<body>`. */
export const Shell = (root: HTMLElement): void => {
  // One call, two places. Under the engine this is `window.domicile`, the
  // control channel on a document the fork served; in an ordinary browser there
  // is none, and `connectToHost` says so on the console and hands back a
  // stand-in — which is worth keeping possible, because the layout can be worked
  // on without a compositor, against apps that will never arrive.
  const domicile = new DomicileClient(connectToHost(window));
  // Binds the SDK to this client: `<app>` is the engine's tag and needs no
  // defining, but the pointer and keyboard over one are the page's to forward, and
  // until this runs nothing does.
  registerElements(domicile);

  /** Every app the host has announced, by the id it announced it under. */
  const mounted = new Map<string, HTMLElement>();

  domicile.on("app_appeared", ({ app_id }) => {
    const element = document.createElement("app");
    element.setAttribute("app-id", app_id);
    // Appending is what puts it on top: the elements are absolutely positioned
    // and share a stacking context, so document order is the stack.
    root.append(element);
    mounted.set(app_id, element);
  });

  /**
   * Where each popup's box starts, by its id: a client's menus and tooltips are
   * `<app>` elements of their own, placed at an offset from what they are over
   * rather than laid out. Every window here fills the screen, so a window's box
   * starts at the corner and a popup's is its offset added up to one.
   */
  const origins = new Map<string, readonly [x: number, y: number]>();

  domicile.on("popup_placed", ({ app_id, parent, position, size }) => {
    const [parentX, parentY] = origins.get(parent) ?? [0, 0];
    const [x, y] = [parentX + position[0], parentY + position[1]];
    origins.set(app_id, [x, y]);
    // Mounted once and moved after: a popup the client repositions is placed
    // again under the same id.
    const element = mounted.get(app_id) ?? document.createElement("app");
    element.setAttribute("app-id", app_id);
    Object.assign(element.style, {
      height: `${size[1].toString()}px`,
      left: `${x.toString()}px`,
      top: `${y.toString()}px`,
      width: `${size[0].toString()}px`,
    });
    // After its window, which is what puts it on top of it.
    root.append(element);
    mounted.set(app_id, element);
  });

  domicile.on("app_closed", ({ app_id }) => {
    origins.delete(app_id);
    const element = mounted.get(app_id);
    if (element === undefined) {
      // Not a case to shrug off: the host announces every app before it closes
      // it, so a close for one that was never announced means this shell and the
      // compositor disagree about what is on the desktop. Everything after that
      // point is guesswork, and a shell that carried on would leak an element per
      // occurrence with nothing said.
      throw new Error(
        `domicile: closed an app that was never opened: ${app_id}`,
      );
    } else {
      element.remove();
      mounted.delete(app_id);
    }
  });

  // The ratio changes when the window moves display or the page zooms, and the
  // page is the only part of Domicile that can see either. Sent straight away:
  // there is no handshake to wait for, and the first call is what binds the
  // channel.
  reportDevicePixelRatio(domicile, window);
};
