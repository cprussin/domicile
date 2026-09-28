// Where a tiled window's edge can be taken hold of without the desktop's
// modifier: along every side it shares with another window, over its own
// border and the gap beside it.

import { Direction } from "../direction";
import type { Rect } from "../rect";
import type { Target } from "./aim";

/**
 * How far into the window its border reaches: enough to find without hunting
 * for it, and little enough to leave the client its own edge pixels.
 */
const INSIDE = 4;

const EDGES = [
  Direction.Left,
  Direction.Right,
  Direction.Up,
  Direction.Down,
] as const;

/** One side of a tiled window that dragging resizes. */
export type Border = {
  edge: Direction;
  id: string;
  rect: Rect;
};

/**
 * The borders of the tiled windows on screen.
 *
 * Only on a side that faces another window: a side against the workspace's
 * edge has nothing to take from. Each reaches half way across the gap, so the
 * two windows either side of it split it between them and the whole of it is
 * a grip.
 */
export const bordersOf = (targets: readonly Target[]): readonly Border[] =>
  targets.flatMap(({ frame, id }) =>
    EDGES.flatMap((edge) => {
      const gaps = targets
        .filter((other) => other.id !== id)
        .flatMap((other) => gapTo(frame, other.frame, edge));
      return gaps.length === 0
        ? []
        : [{ edge, id, rect: stripOf(frame, edge, Math.min(...gaps) / 2) }];
    }),
  );

/**
 * How far `other` is past the `edge` side of `frame`, as a list of one — or
 * of none where it is not beside that side at all.
 */
const gapTo = (
  frame: Rect,
  other: Rect,
  edge: Direction,
): readonly number[] => {
  const { beside, gap } = besideOf(frame, other, edge);
  return beside && gap >= 0 ? [gap] : [];
};

const besideOf = (
  frame: Rect,
  other: Rect,
  edge: Direction,
): { beside: boolean; gap: number } => {
  switch (edge) {
    case Direction.Left: {
      return {
        beside: overlaps(frame.y, frame.height, other.y, other.height),
        gap: frame.x - (other.x + other.width),
      };
    }
    case Direction.Right: {
      return {
        beside: overlaps(frame.y, frame.height, other.y, other.height),
        gap: other.x - (frame.x + frame.width),
      };
    }
    case Direction.Up: {
      return {
        beside: overlaps(frame.x, frame.width, other.x, other.width),
        gap: frame.y - (other.y + other.height),
      };
    }
    case Direction.Down: {
      return {
        beside: overlaps(frame.x, frame.width, other.x, other.width),
        gap: other.y - (frame.y + frame.height),
      };
    }
  }
};

const overlaps = (
  start: number,
  length: number,
  otherStart: number,
  otherLength: number,
): boolean => start < otherStart + otherLength && otherStart < start + length;

/** The strip along `frame`'s `edge`, reaching `outside` past it. */
const stripOf = (frame: Rect, edge: Direction, outside: number): Rect => {
  switch (edge) {
    case Direction.Left: {
      return { ...frame, width: outside + INSIDE, x: frame.x - outside };
    }
    case Direction.Right: {
      return {
        ...frame,
        width: INSIDE + outside,
        x: frame.x + frame.width - INSIDE,
      };
    }
    case Direction.Up: {
      return { ...frame, height: outside + INSIDE, y: frame.y - outside };
    }
    case Direction.Down: {
      return {
        ...frame,
        height: INSIDE + outside,
        y: frame.y + frame.height - INSIDE,
      };
    }
  }
};
