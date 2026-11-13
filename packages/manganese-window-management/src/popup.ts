// Places client popups, such as menus and tooltips, over their windows.

import type { Rect } from "./rect";

/** A popup announced by the host, as stored in the reducer. */
export type Popup = {
  appId: string;
  /** The CSS cursor its client asked for over it. */
  cursor: string;
  /** The synced frame its `<app>` shows. See `DomicileWindow.frame`. */
  frame: number;
  /** The window or popup it is over, by app id. */
  parent: string;
  position: readonly [x: number, y: number];
  size: readonly [width: number, height: number];
};

/** A popup placed on its window's contents. */
export type WindowPopup = {
  appId: string;
  cursor: string;
  frame: number;
  /** Its box, from the top left of its window's contents. */
  rect: Rect;
};

/**
 * The popups over the window `appId`, however many popups deep, oldest first,
 * each at its offsets summed up to the window.
 */
export const popupsOf = (
  popups: readonly Popup[],
  appId: string,
): WindowPopup[] =>
  popups.flatMap((popup) => {
    const over = offsetOf(popups, popup.parent, appId);
    return over === undefined
      ? []
      : [
          {
            appId: popup.appId,
            cursor: popup.cursor,
            frame: popup.frame,
            rect: {
              height: popup.size[1],
              width: popup.size[0],
              x: over.x + popup.position[0],
              y: over.y + popup.position[1],
            },
          },
        ];
  });

/**
 * The top left of `parent` from the window `appId`'s contents, or `undefined`
 * when `parent` is not over that window.
 */
const offsetOf = (
  popups: readonly Popup[],
  parent: string,
  appId: string,
): { x: number; y: number } | undefined => {
  const popup = popups.find((candidate) => candidate.appId === parent);
  if (popup === undefined) {
    return parent === appId ? { x: 0, y: 0 } : undefined;
  } else {
    const over = offsetOf(popups, popup.parent, appId);
    return over === undefined
      ? undefined
      : { x: over.x + popup.position[0], y: over.y + popup.position[1] };
  }
};
