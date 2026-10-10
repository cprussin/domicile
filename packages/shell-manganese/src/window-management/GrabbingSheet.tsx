import { css, cx } from "../../styled-system/css";
import { grabCursorStyles } from "./grab-cursor-styles";
import { GRABBING } from "./placement";
import { GrabCursor } from "./useGrabCursor";

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
    data-grabbing
    style={{ zIndex: GRABBING }}
  />
);

const sheetStyles = css({ inset: 0, position: "fixed" });
