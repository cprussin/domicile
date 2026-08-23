// Telling the host what the page is drawing at, and keeping it told.

import type { BridgeClient } from "./bridge";

/**
 * The page's own view of the display: how dense it is, and how to hear that
 * change.
 *
 * A narrowing of `Window` rather than the whole thing, so a caller outside a
 * browsing context — a test, an engine integration with a view of its own — has
 * a small surface to satisfy.
 */
export type DisplayView = {
  readonly devicePixelRatio: number;
  matchMedia: (query: string) => {
    addEventListener: (
      type: "change",
      listener: () => void,
      options: { once: true },
    ) => void;
  };
};

/**
 * Report the display's density to the host, and report it again whenever it
 * changes.
 *
 * A client can only draw at the display's real resolution if the compositor is
 * told what that is, and the page is the only part of Domicile that can see it:
 * the ratio changes when the window moves to another display, or when the page
 * is zoomed, and neither reaches the compositor any other way. A chrome that
 * reported it once would leave every client drawing at the old resolution —
 * blurry or oversized, with no signal that anything happened.
 *
 * `resolution:` matches at exactly the current ratio, so the query fires on any
 * change at all; each is armed `once` and replaced by a query for the ratio just
 * reported, which is what makes the *second* change audible too.
 *
 * Send it after the handshake: the host ignores everything before it.
 */
export const reportDevicePixelRatio = (
  bridge: Pick<BridgeClient, "setDevicePixelRatio">,
  view: DisplayView,
): void => {
  const ratio = view.devicePixelRatio;
  bridge.setDevicePixelRatio(ratio);
  view.matchMedia(`(resolution: ${ratio.toString()}dppx)`).addEventListener(
    "change",
    () => {
      reportDevicePixelRatio(bridge, view);
    },
    { once: true },
  );
};
