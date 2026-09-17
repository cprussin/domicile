import type { CSSProperties } from "react";

import { css } from "../../styled-system/css";
import type { Rect } from "./rect";

/**
 * What every window shares, which is almost nothing.
 *
 * A background is not among them. A window that shows a client's surface must
 * not paint one: where the compositor draws that surface itself the element is
 * a hole in the page, and a background here would fill the hole in and hide the
 * window behind it. A window that draws its own contents sets its own.
 *
 * `display` is not among them either. A window that lays its own contents out
 * has to set it, and two atomic classes on one element tie on specificity — so
 * a `display` here would silently beat the window's own wherever the bundle
 * happens to order the two rules. Absolute positioning blockifies the box
 * anyway, which is all a window that sets no `display` ever wanted.
 *
 * Nor is a box: every window is placed at a rectangle the layout worked out,
 * and {@link placedAt} is what writes it.
 */
export const windowStyles = css({
  // A window's own `display` would otherwise beat the `hidden` attribute's UA
  // rule; this selector outranks it.
  "&[hidden]": { display: "none" },
});

/**
 * Where a part of a window sits, as the inline style that puts it there.
 *
 * Inline rather than a Panda class because these are runtime numbers, and
 * Panda extracts styles by reading literals at build time: a class built from
 * a number that does not exist yet comes out with no rule behind it.
 *
 * `depth` becomes the element's *own* `z-index` — which is what the SDK
 * reports with the placement and what the compositor stacks the client's
 * surface by. On the element rather than on a wrapper for exactly that reason:
 * a wrapper's `z-index` is one the page can see and the desktop cannot.
 *
 * **In the desktop's coordinates rather than any container's.** The page spans
 * every display, so the viewport *is* the desktop: a window at 0 is at its
 * corner, over the top bar, which is where a fullscreen or dragged window is
 * allowed to be. It is the same space `<Screen>` places its regions in.
 */
export const placedAt = (rect: Rect, depth: number): CSSProperties => ({
  blockSize: `${rect.height.toString()}px`,
  inlineSize: `${rect.width.toString()}px`,
  insetBlockStart: `${rect.y.toString()}px`,
  insetInlineStart: `${rect.x.toString()}px`,
  position: "fixed",
  zIndex: depth,
});

/**
 * What a window looks like while it is being dragged: most of the way there.
 *
 * A real translucency rather than a hint of one, because it is the compositor
 * that draws it: the SDK reports the element's `opacity` with the placement and
 * the shader applies it to the client's own buffer, so what shows through a
 * half-transparent window is the desktop behind it rather than anything the
 * page could have painted over it.
 */
export const draggingStyles = css({ opacity: 0.6 });

/**
 * The line around a window, so its edge is visible against whatever it is
 * over.
 *
 * On the page rather than on the client: the element is a hole and the border
 * is drawn around the hole, which is the one part of a window's frame the
 * compositor does not have to be told about.
 *
 * The colour is not here: it says which window the keyboard is in, so it comes
 * from {@link focusedEdgeStyles} or {@link restingEdgeStyles}.
 */
export const edgeStyles = css({
  borderStyle: "solid",
  borderWidth: "1px",
});

/**
 * What colour that line is, which is the window's share of saying where the
 * keyboard is: the accent for the window being worked in, and the resting
 * line for every other one.
 *
 * Two classes rather than one with an override, because two rules setting
 * `border-color` on one element are decided by the order Panda happens to
 * emit them in — so exactly one of these is ever applied.
 */
export const focusedEdgeStyles = css({ borderColor: "accent" });

export const restingEdgeStyles = css({ borderColor: "borderStrong" });

/**
 * A window the pointer goes straight through.
 *
 * How the shell takes the mouse back while the desktop's modifier is held. The
 * compositor hit-tests a rectangle and gives the pointer to the window under
 * it; a window that says `pointer-events: none` is reported as taking no
 * pointer, so the events arrive in the page instead — which is where a drag is
 * handled. The same mechanism that stops a window swallowing the clicks meant
 * for a menu drawn over it.
 */
export const clickThroughStyles = css({ pointerEvents: "none" });
