// Places client popups, such as menus and tooltips, on screen.

import type { Placement } from "./placement";
import type { Rect } from "./rect";
import { appWindowId } from "./window";

/** A popup announced by the host, as stored in the reducer. */
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
 * Places each popup at its offset from its parent chain's window, at that
 * window's depth. Popups come later in the document, so they draw on top.
 *
 * Skips popups whose window has no contents on this screen; embedding one here
 * would take its pixels from the page that shows the window.
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

/** The top-left of `appId`'s box on screen, and its window's depth. */
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
