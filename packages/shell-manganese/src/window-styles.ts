import type { CSSProperties } from "react";

import { css } from "../styled-system/css";
import type { Float } from "./float";

/**
 * What every window shares: it fills the stage, and the one that is not on it
 * has no box at all.
 *
 * A background is not among them. A window that shows a client's surface must
 * not paint one: where the compositor draws that surface itself the element is
 * a hole in the page, and a background here would fill the hole in and hide the
 * window behind it. A window that draws its own contents sets its own.
 *
 * `display` is not among them either. A window that lays its own
 * contents out has to set it, and two atomic classes on one element tie on
 * specificity — so a `display` here silently beats the window's own wherever
 * the bundle happens to order the two rules. Absolute positioning blockifies
 * the box anyway, which is all a window that sets no `display` ever wanted.
 *
 * Filling the stage is spelled as four properties rather than `inset: 0`
 * because a floating window overrides them one at a time — see
 * {@link floatPlacement}. `inset` would leave `right` and `bottom` behind, and
 * a box with a left, a right and a width is over-constrained: it lays out by
 * the rule that says which one to ignore, which is not a rule to lay a desktop
 * out by.
 */
export const windowStyles = css({
  // A window's own `display` would otherwise beat the `hidden` attribute's UA
  // rule; this selector outranks it.
  "&[hidden]": { display: "none" },
  blockSize: "100%",
  inlineSize: "100%",
  insetBlockStart: 0,
  insetInlineStart: 0,
  position: "absolute",
});

/**
 * The lowest `z-index` a floating window is given.
 *
 * Above the stage, which has none: a window that left the rail is over the one
 * that is still on it, always, whatever order the two happen to be in the DOM.
 */
const FLOOR = 1;

/**
 * Where a floating window sits, as the inline style that puts it there.
 *
 * Inline rather than a Panda class because these are runtime numbers, and
 * Panda extracts styles by reading literals at build time: a class built from
 * a number that does not exist yet comes out with no rule behind it. Everything
 * static is in {@link windowStyles}, which this overrides property for
 * property.
 *
 * `depth` is the window's place in the shell's float order, and it becomes the
 * element's *own* `z-index` — which is what the SDK reports with the placement
 * and what the compositor stacks the client's surface by. On the element
 * rather than on a wrapper for exactly that reason: a wrapper's `z-index` is
 * one the page can see and the desktop cannot.
 */
export const floatPlacement = (float: Float, depth: number): CSSProperties => ({
  blockSize: `${float.height.toString()}px`,
  inlineSize: `${float.width.toString()}px`,
  insetBlockStart: `${float.y.toString()}px`,
  insetInlineStart: `${float.x.toString()}px`,
  zIndex: FLOOR + depth,
});
