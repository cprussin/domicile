import type { CSSProperties } from "react";

import { css, cva } from "../../styled-system/css";
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
 * The color is not here: it says which window the keyboard is in, so it comes
 * from {@link focusedEdgeStyles} or {@link restingEdgeStyles}.
 */
export const edgeStyles = css({
  borderStyle: "solid",
  borderWidth: "1px",
});

/**
 * What color that line is, which is the window's share of saying where the
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
 * The point a part of a window turns about, as the inline style that puts it
 * there: the middle of the whole frame, wherever that falls inside this part.
 *
 * **One window, one point.** A window is two elements — the bar and the
 * contents under it — and each of them scaled about its own center would pull
 * away from the other by a fraction of the window's height, which is a frame
 * coming apart rather than a window arriving. Given the frame they span, both
 * of them name the same point on the desktop and the window grows and shrinks
 * in one piece.
 *
 * Inline for the reason {@link placedAt} is: these are runtime numbers, and
 * Panda extracts styles by reading literals at build time.
 *
 * It costs the mapping a client's pointer is inverted through nothing at all.
 * `transform-origin` conjugates a transform by a translation, which leaves its
 * linear part alone, and the SDK solves for the translation from where the box
 * actually lands — so every origin gives the same answer. See the chrome SDK's
 * `element-transform.ts`.
 */
export const scaledAbout = (frame: Rect, rect: Rect): CSSProperties => ({
  transformOrigin: `${(frame.x + frame.width / 2 - rect.x).toString()}px ${(frame.y + frame.height / 2 - rect.y).toString()}px`,
});

/**
 * What a window is doing over time, drawn.
 *
 * Every one of these is a transform and an opacity, which is what makes them
 * free: the compositor is already drawing the client's buffer into a layer of
 * this page, so scaling or sliding that layer is the page's own compositing
 * rather than anything the client is asked to redraw. The keyframes are in
 * `panda.config.ts`, with why each one looks the way it does.
 *
 * Its variant is keyed by `WindowMotion`, which is why that is a string union
 * rather than an enum: a motion the shell can ask for and this does not name
 * is a call that does not compile.
 *
 * **Opening and closing run for as long as the layout does**, which is what
 * makes a window and the space around it one movement rather than two. The
 * windows either side of one that opens or closes are easing into their new
 * boxes over `durations.fast` — see {@link settlingStyles} — so a window that
 * took twice as long to go was still shrinking over a desktop that had
 * finished rearranging itself around it.
 *
 * **And both of them lead with the movement.** `easings.outQuart` puts most of
 * the scale and most of the fade in the first few frames and lets the rest
 * settle, which is what a window appearing or going away should feel like. The
 * usual curve for something leaving is the other way round — accelerate out —
 * and at this length it reads as a window sitting still and then being
 * snatched.
 *
 * The two departures end `forwards`, so the last frame is what the window is
 * left at. Without it a window would snap back to full size and full opacity
 * for however long it takes the desktop to hear that the animation has ended
 * and take the element off the page.
 */
export const movingStyles = cva({
  variants: {
    motion: {
      "arriving-from-end": {
        animation: "windowArrivingFromEnd {durations.slow} {easings.out}",
      },
      "arriving-from-start": {
        animation: "windowArrivingFromStart {durations.slow} {easings.out}",
      },
      closing: {
        animation: "windowClosing {durations.fast} {easings.outQuart} forwards",
      },
      "leaving-to-end": {
        animation: "windowLeavingToEnd {durations.slow} {easings.in} forwards",
      },
      "leaving-to-start": {
        animation:
          "windowLeavingToStart {durations.slow} {easings.in} forwards",
      },
      opening: {
        animation: "windowOpening {durations.fast} {easings.outQuart}",
      },
      // A window that is simply on the desktop, which is most of them most of
      // the time. Revealed by a workspace switch, a tab, a fullscreen let go
      // of: it is there, and a window that is there has nothing to play.
      resting: {},
    },
  },
});

/**
 * How a window gets from one look to the next rather than snapping to it.
 *
 * Two things move, and only one of them is always allowed to ease.
 *
 * **The box.** Every rectangle on this desktop is arithmetic — see
 * `tree/frames.ts` — so a window whose neighbor opened, closed, split or grew
 * is simply written at a different `inset` and size on the next render, and
 * lands there between two frames. This is what gives it the frames in between.
 *
 * The box rather than a transform, unlike everything in {@link movingStyles}:
 * the window really is a different size afterwards, and the client has to be
 * configured at it. The SDK measures every window once an animation frame, so
 * what it reports during a transition is each intermediate box — the same
 * stream of sizes a drag on a floating window's corner already produces, over
 * a sixth of a second rather than as long as the user holds it.
 *
 * **Not while the window is being dragged.** A drag writes a new box on every
 * pointer move, and a window easing towards each of them is one that trails
 * the pointer instead of following it.
 *
 * **The colors**, which are what a window says about the keyboard — the fill
 * of its bar, the line around its frame, the text on it. Those ease whichever
 * of the two states the window is in, dragged or not: focus follows the cursor
 * in this shell, so they change every time the pointer crosses a window, and a
 * desktop that snapped between them flickered on the way to anywhere. A drag
 * is when the pointer crosses the most windows of all.
 *
 * **One declaration for both**, which is why the box and the colors are one
 * recipe rather than a class each: two rules setting `transition` on one
 * element are decided by the order Panda happens to emit them in, and the
 * loser is simply not applied.
 */
export const settlingStyles = cva({
  variants: {
    dragging: {
      false: {
        transition:
          "inline-size {durations.fast} {easings.out}, block-size {durations.fast} {easings.out}, inset-block-start {durations.fast} {easings.out}, inset-inline-start {durations.fast} {easings.out}, background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, color {durations.fast} {easings.out}",
      },
      true: {
        transition:
          "background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, color {durations.fast} {easings.out}",
      },
    },
  },
});
