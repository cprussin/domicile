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

/**
 * A window arriving: it fades up and grows into the box the layout has
 * already given it.
 *
 * On the window and on its bar alike, because the two are separate elements
 * and a frame whose halves scale differently comes apart at the seam. Both
 * scale from `top left` for the same reason: their own centres are different
 * points, so centre-scaled halves would pull away from each other by a
 * fraction of the window's whole height, while one shared corner holds them
 * together. The corner is not quite the same point either — the window's is a
 * bar's height below the bar's — so what is left is a slit of
 * `(1 - scale) × TITLE_BAR`, under two pixels, closing over the length of the
 * animation.
 *
 * **It runs whenever the window arrives on screen, which is not only when it
 * opens.** A window the desktop is not showing is hidden rather than
 * unmounted — that is what keeps its client's surface and its page alive — and
 * an element that is `display: none` runs no animation, so the one here starts
 * again when the window is revealed: a workspace switched to, a tab picked, a
 * fullscreen let go of. Everything the user sees appear, appears the same way.
 */
export const openingStyles = css({
  animation: "windowOpening {durations.fast} {easings.out}",
  transformOrigin: "top left",
});

/**
 * A window leaving: it fades down and shrinks away from the box it had.
 *
 * `forwards`, so the last frame is what it is left at. Without it the window
 * would snap back to full size for however long it takes the desktop to hear
 * that the animation has ended and take the element off the page.
 */
export const closingStyles = css({
  animation: "windowClosing {durations.fast} {easings.in} forwards",
  transformOrigin: "top left",
});

/**
 * A window moving to a new box rather than appearing at one.
 *
 * Every rectangle on this desktop is arithmetic — see `tree/frames.ts` — so a
 * window whose neighbour opened, closed, split or grew is simply written at a
 * different `inset` and size on the next render, and lands there between two
 * frames. This is what gives it the frames in between.
 *
 * The box rather than a transform, unlike the arrival above: the window really
 * is a different size afterwards, and the client has to be configured at it.
 * The SDK measures every window once an animation frame, so what it reports
 * during a transition is each intermediate box — the same stream of sizes a
 * drag on a floating window's corner already produces, over a sixth of a
 * second rather than as long as the user holds it.
 *
 * **Not while the window is being dragged.** A drag writes a new box on every
 * pointer move, and a window easing towards each of them is one that trails
 * the pointer instead of following it.
 */
export const settlingStyles = css({
  transition:
    "inline-size {durations.fast} {easings.out}, block-size {durations.fast} {easings.out}, inset-block-start {durations.fast} {easings.out}, inset-inline-start {durations.fast} {easings.out}",
});
