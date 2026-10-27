import { css, cx } from "../styled-system/css";
import { grabCursorStyles } from "./grab-cursor-styles";
import { GRABBING } from "./placement";
import { GrabCursor } from "./useGrabCursor";

/**
 * Marks the sheet, so document listeners can tell it from the bare desk. See
 * `useScreenFollowsPointer`.
 */
export const GRABBING_SHEET = "data-grabbing";

/**
 * A transparent sheet over the whole desktop while a window moves, so the
 * pointer shows `grabbing` over gaps, the wallpaper and the top bar too.
 *
 * The drag reads the pointer from `window`, so the sheet takes nothing from
 * it.
 */
export const GrabbingSheet = () => (
  // `aria-hidden`: it has no content.
  <div
    aria-hidden
    className={cx(sheetStyles, grabCursorStyles[GrabCursor.Grabbing])}
    {...{ [GRABBING_SHEET]: "" }}
    style={{ zIndex: GRABBING }}
  />
);

const sheetStyles = css({ inset: 0, position: "fixed" });
