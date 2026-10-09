import { useCallback, useState } from "react";

import type { Rect } from "./rect";
import type { StripPlace } from "./tree/frames";

/**
 * A tab's slide to its new place after it moved along its strip: how far it
 * was from there, and which of the two keyframe names plays it.
 */
export type StripMove = {
  /** Plays `windowSlidingTabAgain`, so a move during a slide restarts it. */
  again: boolean;
  x: number;
  y: number;
};

/** The place and box a tab had in the last render. */
type Seen = {
  at: number | undefined;
  tabs: number | undefined;
  x: number;
  y: number;
};

/**
 * The slide a tab is playing after moving along its strip, and a callback for
 * when it has played out.
 *
 * A move keeps the strip's tab count and changes the tab's place. A tab opening
 * or closing changes the count instead, and every slot after it eases along
 * together.
 *
 * Compares renders during render, as `useWindowMotion` does, so the first
 * render at the new place already slides.
 */
export const useStripMove = (
  strip: StripPlace | undefined,
  rect: Rect,
): { move: StripMove | undefined; onMoved: () => void } => {
  // One state, not two: React may keep only one of two updates made during
  // render.
  const [{ move, seen }, setState] = useState<{
    move: StripMove | undefined;
    seen: Seen;
  }>({ move: undefined, seen: seenOf(strip, rect) });

  const now = seenOf(strip, rect);
  if (changed(seen, now)) {
    setState({
      move: movedAlong(seen, now)
        ? {
            again: move !== undefined && !move.again,
            x: seen.x - now.x,
            y: seen.y - now.y,
          }
        : move,
      seen: now,
    });
  }

  const onMoved = useCallback(() => {
    setState((state) => ({ ...state, move: undefined }));
  }, []);

  return { move, onMoved };
};

const seenOf = (strip: StripPlace | undefined, rect: Rect): Seen => ({
  at: strip?.at,
  tabs: strip?.tabs,
  x: rect.x,
  y: rect.y,
});

const changed = (seen: Seen, now: Seen): boolean =>
  seen.at !== now.at ||
  seen.tabs !== now.tabs ||
  seen.x !== now.x ||
  seen.y !== now.y;

const movedAlong = (seen: Seen, now: Seen): boolean =>
  seen.at !== undefined &&
  now.at !== undefined &&
  seen.tabs === now.tabs &&
  seen.at !== now.at;
