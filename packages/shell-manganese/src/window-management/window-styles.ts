import type { CSSProperties } from "react";

import { css, cva } from "../../styled-system/css";
import type { Rect } from "./rect";
import type { Restack } from "./restacking";
import type { TabLayout } from "./tree/frames";
import { Layout } from "./tree/node";

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
 * `depth` becomes the element's *own* `z-index`, which is what stacks the
 * client's surface: the window is a layer in this page's layer tree, so the
 * page's compositor orders it by this the way it orders anything else. On the
 * element rather than on a wrapper for exactly that reason — a wrapper's
 * `z-index` stacks the wrapper, and the window is not in it.
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
 * A real translucency rather than a hint of one, because it is the page's own
 * compositor that draws it: `opacity` on the element is `opacity` on a layer,
 * and the window is one — so it is applied to the client's buffer the way it
 * would be to a hardware-composited `<video>`, and what shows through a
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
 * The rounded bottom of a window's frame, which is the other half of the
 * corners its bar rounds at the top.
 *
 * The bottom two only: the top of a window meets its bar, and a radius there
 * would cut a notch out of the seam between the two. On the `<app>` itself
 * rather than on anything around it, because the element is a layer and
 * `border-radius` on a layer is a rounded clip of what is drawn in it — the
 * client's own pixels included. See `WINDOW-COMPOSITING.md`.
 */
export const bottomCornerStyles = css({
  borderEndEndRadius: "lg",
  borderEndStartRadius: "lg",
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
 * The shuffle a window plays when it trades places with another in the stack,
 * as the inline custom properties the `windowRestacking` keyframes read.
 *
 * Custom properties because both halves are runtime numbers — which way this
 * window parts, and the two depths it trades — and a keyframe is a literal.
 * The depths go through the animation rather than straight to `z-index`,
 * because the whole point is *when* they change: at the furthest point apart,
 * so the one going over is seen to come out from under the other first.
 *
 * Nothing for a window that is not shuffling.
 */
export const shuffledBy = (
  restack: Restack | undefined,
): Record<`--${string}`, number | string> =>
  restack === undefined
    ? {}
    : {
        "--restack-from": restack.from,
        "--restack-to": restack.to,
        "--restack-x": `${restack.away.x.toString()}px`,
        "--restack-y": `${restack.away.y.toString()}px`,
      };

/**
 * Which way a tab closes up, as the inline custom property the
 * `windowClosingTab` keyframes read: across for a tabbed container's tab, down
 * for a stack's.
 *
 * Written on the bar alone. The contents of a window that was its container's
 * shown tab play the same keyframes without it, which is a fade and nothing
 * else — see `panda.config.ts`.
 *
 * Nothing for a bar that is not a tab.
 */
export const collapsedAlong = (
  tabbed: TabLayout | undefined,
): Record<`--${string}`, number> => {
  switch (tabbed) {
    case Layout.Stacking: {
      return { "--collapse-y": 0 };
    }
    case Layout.Tabbed: {
      return { "--collapse-x": 0 };
    }
    case undefined: {
      return {};
    }
  }
};

/**
 * How far a workspace slides when it is switched to or away from, as the
 * inline custom property the switch keyframes read: the width of its screen,
 * so the two workspaces are side by side the whole way across.
 *
 * On the stage rather than on each window, because a custom property is
 * inherited: every window, bar and ring on it reads the one value. A runtime
 * number for the reason {@link shuffledBy}'s are.
 */
export const slidAcross = (width: number): Record<`--${string}`, string> => ({
  "--workspace-width": `${width.toString()}px`,
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
 * The departures end `forwards`, so the last frame is what the window is
 * left at. Without it a window would snap back to how it started for however
 * long it takes the desktop to hear that the animation has ended and take the
 * element off the page.
 */
export const movingStyles = cva({
  variants: {
    motion: {
      // The two workspaces of a switch move as one strip: the same distance,
      // the same length and the same curve, so they stay side by side while
      // they cross. `emphasized` rather than the openings' `outQuart`: this
      // one crosses a whole screen, and a curve that starts at full speed
      // moves it a tenth of the way in the first frame.
      "arriving-from-end": {
        animation:
          "windowArrivingFromEnd {durations.slower} {easings.emphasized}",
      },
      "arriving-from-start": {
        animation:
          "windowArrivingFromStart {durations.slower} {easings.emphasized}",
      },
      closing: {
        animation: "windowClosing {durations.fast} {easings.outQuart} forwards",
      },
      // On the curve the tabs beside it ease their boxes over the gap on —
      // see {@link settlingStyles} — so its edges and theirs move together.
      "closing-tab": {
        animation: "windowClosingTab {durations.fast} {easings.out} forwards",
      },
      // The window a tab switch hides, held under the one fading in over it
      // — see the keyframes. It plays for as long as that one does, so it is
      // under it until the last frame.
      concealing: {
        animation: "windowConcealing {durations.fast} {easings.in-out}",
      },
      "leaving-to-end": {
        animation:
          "windowLeavingToEnd {durations.slower} {easings.emphasized} forwards",
      },
      "leaving-to-start": {
        animation:
          "windowLeavingToStart {durations.slower} {easings.emphasized} forwards",
      },
      opening: {
        animation: "windowOpening {durations.fast} {easings.outQuart}",
      },
      // A float trading places with one it overlaps, shuffled like a card: the
      // two part, trade depths while apart, and come back together the other
      // way up. Which way and which depths are the window's own, handed to the
      // keyframes by {@link shuffledBy}. `in-out` on each half, so the pair
      // hang apart for a moment at the point where they trade.
      restacking: {
        animation: "windowRestacking {durations.slower} {easings.in-out}",
      },
      // The same shuffle under another name, so a window shuffled again
      // straight away starts over rather than going on with the last one.
      "restacking-again": {
        animation: "windowRestackingAgain {durations.slower} {easings.in-out}",
      },
      // A window that is simply on the desktop, which is most of them most of
      // the time. Revealed by a workspace switch, a fullscreen let go of: it
      // is there, and a window that is there has nothing to play.
      resting: {},
      // The window a tab switch shows, fading in over the one it hides: the
      // two are in one box, so a fade is a crossfade.
      revealing: {
        animation: "windowRevealing {durations.fast} {easings.in-out}",
      },
    },
  },
});

/**
 * How a window gets from one look to the next rather than snapping to it.
 *
 * Four things move, and only the first of them is ever held back.
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
 * **The depth**, which is a window's `z-index` and so an integer, and an
 * integer is something CSS interpolates. That is what makes it move *with* the
 * box instead of before it: a window on its way up is over what it is growing
 * across from the first frame of the movement, and one on its way down is
 * still over what it is shrinking back into until the last. Over the same
 * duration and the same curve as the box, because it is the same movement.
 *
 * Which is what giving the screen back needs. A window that dropped from the
 * depth a fullscreen window is given — see `placement.ts` — to its tiled one
 * the moment the state changed would spend the whole of its shrink *under* the
 * windows it is still covering: they tie at that depth, and a tie is decided
 * by the order the windows come in the document, which is the order they were
 * opened. A raise that moves nothing else — clicking a float to the front — is
 * a step of one rather than of two thousand, which this curve spends in a
 * frame.
 *
 * It eases while the window is dragged as well, unlike the box: taking hold
 * of a float raises it, and that is a step of one too.
 *
 * **The colors**, which are what a window says about the keyboard — the wash
 * over its bar, the line around its frame, the text on it. Those ease whichever of the two states the window is in, dragged
 * or not: focus follows the cursor in this shell, so they change every time the
 * pointer crosses a window, and a desktop that snapped between them flickered
 * on the way to anywhere. A drag is when the pointer crosses the most windows
 * of all.
 *
 * **The opacity**, which is {@link draggingStyles} coming and going: the
 * window fades as it is taken hold of and fades back as it is let go, rather
 * than blinking at both ends of the drag. Dragged or not, because those are
 * the two ends.
 *
 * **One declaration for all four**, which is why the box, the depth, the
 * colors and the opacity are one recipe rather than a class each: two rules
 * setting `transition` on one element are decided by the order Panda happens
 * to emit them in, and the loser is simply not applied.
 */
export const settlingStyles = cva({
  variants: {
    dragging: {
      false: {
        transition:
          "inline-size {durations.fast} {easings.out}, block-size {durations.fast} {easings.out}, inset-block-start {durations.fast} {easings.out}, inset-inline-start {durations.fast} {easings.out}, z-index {durations.fast} {easings.out}, background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, color {durations.fast} {easings.out}, opacity {durations.fast} {easings.out}",
      },
      true: {
        transition:
          "z-index {durations.fast} {easings.out}, background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, color {durations.fast} {easings.out}, opacity {durations.fast} {easings.out}",
      },
    },
  },
});
