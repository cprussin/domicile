// A client's popups — its menus and tooltips — as this shell places them.

import type { Placement } from "./placement";
import type { Rect } from "./rect";
import { appWindowId } from "./window";

/** A popup the host announced, as the reducer holds it. */
export type Popup = {
  appId: string;
  /** The window or popup it is over, by app id. */
  parent: string;
  position: readonly [x: number, y: number];
  size: readonly [width: number, height: number];
};

/** Where one popup is drawn. */
export type PlacedPopup = {
  appId: string;
  depth: number;
  rect: Rect;
};

/**
 * Where each popup goes over the windows placed on this screen: its offset
 * from what it is over, all the way down to a window's contents, and that
 * window's depth — later in the document than the window, so it wins the tie.
 *
 * None for a window with no contents here: one on another workspace, or on
 * another page of the desk, where embedding the popup would take its pixels
 * from the page that shows its window.
 */
export const popupsOver = (
  popups: readonly Popup[],
  placements: readonly Placement[],
): PlacedPopup[] =>
  popups.flatMap((popup) => {
    const over = origin(popups, placements, popup.parent);
    return over === undefined
      ? []
      : [
          {
            appId: popup.appId,
            depth: over.depth,
            rect: {
              height: popup.size[1],
              width: popup.size[0],
              x: over.x + popup.position[0],
              y: over.y + popup.position[1],
            },
          },
        ];
  });

/** The top-left of `appId`'s box on screen, and the depth of its window. */
const origin = (
  popups: readonly Popup[],
  placements: readonly Placement[],
  appId: string,
): { depth: number; x: number; y: number } | undefined => {
  const popup = popups.find((candidate) => candidate.appId === appId);
  if (popup === undefined) {
    const placement = placements.find(({ id }) => id === appWindowId(appId));
    return placement?.surface === undefined
      ? undefined
      : {
          depth: placement.depth,
          x: placement.surface.x,
          y: placement.surface.y,
        };
  } else {
    const over = origin(popups, placements, popup.parent);
    return over === undefined
      ? undefined
      : {
          depth: over.depth,
          x: over.x + popup.position[0],
          y: over.y + popup.position[1],
        };
  }
};
