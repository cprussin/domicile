// Telling the host how big the desktop is, and keeping it told.

import type { BridgeClient } from "./bridge";

/**
 * The page's own view of the desktop: how big it is, and how to hear that
 * change.
 *
 * A narrowing of `Window` for the reason `DisplayView` beside it is one — a
 * caller outside a browsing context has a small surface to satisfy.
 */
export type ViewportView = {
  addEventListener: (type: "resize", listener: () => void) => void;
  readonly innerHeight: number;
  readonly innerWidth: number;
};

/**
 * Report the desktop's size to the host, and report it again whenever it
 * changes.
 *
 * **The chrome's window is the desktop, and the page is the only part of
 * Domicile that can see it.** Where the compositor draws that window itself it
 * reads the size off it; under the forked engine the window belongs to the
 * browser and the compositor never sees it, so without this the desktop stays
 * at `compositor.nested_size` for the whole run — a chrome laid out for that
 * size in the corner of whatever the user actually opened, and every client
 * told a screen that is not the screen.
 *
 * CSS pixels, which is what the compositor's logical units are and what
 * `<Screen>` lays out in. The density goes separately and the compositor
 * multiplies: a mode is a size and a scale, and sending the product here would
 * be the same fact twice with two chances to disagree.
 *
 * A plain `resize` listener, *not* armed `once` and re-armed the way
 * `reportDevicePixelRatio` has to arm its `matchMedia` query — that one is a
 * query for one exact ratio and has to be replaced to hear the next change,
 * where this fires on every resize as it is. Written the other way it would go
 * deaf after the first drag.
 *
 * Send it after the handshake: the host ignores everything before it.
 */
export const reportDesktopSize = (
  bridge: Pick<BridgeClient, "setDesktopSize">,
  view: ViewportView,
): void => {
  const report = () => {
    bridge.setDesktopSize([view.innerWidth, view.innerHeight]);
  };
  report();
  view.addEventListener("resize", report);
};
