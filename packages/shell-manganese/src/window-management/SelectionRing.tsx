import { useState } from "react";

import { css, cx } from "../../styled-system/css";
import type { Restack } from "./restacking";
import type { Selection } from "./selection";
import type { WindowMotion } from "./window-motion";
import {
  movingStyles,
  placedAt,
  settlingStyles,
  shuffledBy,
} from "./window-styles";

type Props = {
  /**
   * What the window it rings is doing, which it does too while that is a
   * shuffle — the same one of the two, so it starts over when the window does
   * — or a workspace switch bringing it on, or the window opening where there
   * was no ring before.
   */
  motion?: WindowMotion | undefined;
  /**
   * The shuffle the window it rings is playing, which it plays too — or
   * `undefined` while that window is not shuffling, or it rings a group.
   */
  restack?: Restack | undefined;
  selection: Selection;
};

/**
 * The ring around what the commands are pointed at — sway's indicator.
 *
 * **One ring, whether that is a window or a group.** `focus parent` moves the
 * commands from the window the keyboard is in out to the container around it,
 * and this is the same element either way, so it eases from the one box to
 * the other — see `settlingStyles` — rather than one line vanishing as another
 * appears. Not while its window is dragged, though: a ring easing after each
 * step of a drag trails behind the window it rings. The window's own frame
 * goes on saying where the keyboard is inside a group, because that is still
 * where it is.
 *
 * **Carried on with a workspace, though.** A switch moves the keyboard to a
 * window that is sliding in, and a ring easing across from the last one would
 * cross the screen on its own while the windows slide. It is put at the new
 * box straight away and slides in with its window instead.
 *
 * **Around a window that has just opened too.** The ring is where the
 * keyboard is, so it slides across from the last window to the new one rather
 * than reappearing there — the eye follows it instead of hunting for it.
 *
 * **Unless there was no last window.** The first window of a workspace has
 * nothing to slide across from, so the ring grows in with it — a ring drawn at
 * full size around a window still growing in is a line out ahead of it.
 *
 * At the depth of what it rings and after every window in the document, which
 * puts it over that window's bar and the client surface along all four sides
 * — and under the floats over it. It takes no pointer, so a band of accent
 * along the outer edge is the whole of what it costs them.
 */
export const SelectionRing = ({
  motion = "resting",
  restack,
  selection,
}: Props) => {
  const { bar, dragging, rect } = selection;
  // The tab's place along the top, in the ring's own coordinates.
  const before = bar.x - rect.x;
  const after = rect.x + rect.width - (bar.x + bar.width);
  // Whether the ring came on with the window it rings opening — which it
  // stops being for good once that window has finished, so a later window
  // opening is slid across to rather than grown in with. Adjusted while
  // rendering rather than in an effect, so the frame it changes is this one.
  const [appearing, setAppearing] = useState(motion === "opening");
  if (appearing && motion !== "opening") {
    setAppearing(false);
  }
  const carried = restack !== undefined || isArrival(motion) || appearing;
  // Held at its box for a switch for the reason a drag holds it: something
  // else is already carrying it there.
  const parts = settlingStyles({ dragging: dragging || isArrival(motion) });
  return (
    <div
      className={cx(ringStyles, carried && movingStyles({ motion }), parts)}
      // What is selected, as an attribute as well as a line: the desktop's own
      // state is worth being able to read off the element, in devtools and in
      // a test, rather than only off a hashed class name.
      data-selection={selection.group ? "group" : "window"}
      style={{
        ...placedAt(rect, selection.depth),
        ...shuffledBy(restack),
      }}
    >
      <div
        className={cx(partStyles, tabStyles, parts)}
        data-part="tab"
        style={{
          blockSize: px(bar.height),
          inlineSize: px(bar.width),
          insetInlineStart: px(before),
        }}
      />
      <div
        className={cx(partStyles, seamStyles, beforeStyles, parts)}
        data-part="before"
        style={{ blockSize: px(bar.height), inlineSize: px(before) }}
      />
      <div
        className={cx(partStyles, seamStyles, afterStyles, parts)}
        data-part="after"
        style={{ blockSize: px(bar.height), inlineSize: px(after) }}
      />
      <div
        className={cx(partStyles, bodyStyles, parts)}
        data-part="body"
        style={{ insetBlockStart: px(bar.height) }}
      />
    </div>
  );
};

/**
 * A border rather than an `outline`, so the line falls *inside* the box.
 *
 * The container `focus parent` selects can be the workspace's own, whose edge
 * is the edge of the screen — and a line drawn outside that one is a line
 * drawn off it. Inside is also where a window's own edge is, so the ring
 * covers that line rather than drawing a second one beside it.
 *
 * And the pointer goes straight through. It covers every window it rings, and
 * the compositor gives the pointer to whatever element is under it, so a ring
 * that took the pointer would take it off all of them at once — which is
 * focus-follows-cursor and every client's clicks.
 */
const ringStyles = css({ pointerEvents: "none" });

/**
 * **Drawn in four pieces rather than as one border**, so the line can rise
 * around the open tab of a tabbed container and run under the tabs beside it:
 * the tab, a seam either side of it along the bottom of the bar, and the body
 * under the bar. A ring around the whole box was drawn across every tab and
 * said nothing about which of them was open.
 *
 * Every piece is a box the ring's own transition eases, so the tab slides
 * along the bar from one tab to the next rather than jumping — the pieces are
 * sized in the same pixels as the ring, over the same curve, so they meet
 * wherever the movement is. Around a window or a group the tab is the whole
 * width, both seams are nothing, and it is the one rounded box it always was.
 */
const partStyles = css({
  borderColor: "accent",
  borderStyle: "solid",
  // Solid, and twice a window's own edge, off the spacing scale rather than
  // written as a length: a line that has to be found at a glance is not the
  // one-pixel edge that STYLING's literal is for.
  borderWidth: "{spacing.0.5}",
  position: "absolute",
});

// Rounded at the top as the bars are — see `TitleBar` — and open at the
// bottom into the body.
const tabStyles = css({
  borderBlockEndWidth: 0,
  borderStartEndRadius: "lg",
  borderStartStartRadius: "lg",
  insetBlockStart: 0,
});

// The line along the bottom of the tabs beside the open one.
const seamStyles = css({
  borderBlockStartWidth: 0,
  borderInlineWidth: 0,
  insetBlockStart: 0,
});

const beforeStyles = css({ insetInlineStart: 0 });

const afterStyles = css({ insetInlineEnd: 0 });

// Open at the top into the tab and the seams, and rounded at the bottom as the
// windows are — see `bottomCornerStyles`.
const bodyStyles = css({
  borderBlockStartWidth: 0,
  borderEndEndRadius: "lg",
  borderEndStartRadius: "lg",
  insetBlockEnd: 0,
  insetInline: 0,
});

const isArrival = (motion: WindowMotion): boolean => {
  switch (motion) {
    case "arriving-from-end":
    case "arriving-from-start": {
      return true;
    }
    case "closing":
    case "closing-tab":
    case "concealing":
    case "leaving-to-end":
    case "leaving-to-start":
    case "opening":
    case "restacking":
    case "restacking-again":
    case "resting":
    case "revealing": {
      return false;
    }
  }
};

const px = (length: number): string => `${length.toString()}px`;
