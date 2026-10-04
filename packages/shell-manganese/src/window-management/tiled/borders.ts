// Resize strips for tiled windows, usable without the modifier: along each
// side shared with another window, covering the border and the gap.

import { Direction } from "../direction";
import type { Rect } from "../rect";
import type { Target } from "./aim";

/**
 * How far a border reaches into the window: easy to hit, while leaving the
 * client its edge pixels.
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
 * Only sides facing another window get one. Each reaches halfway across the
 * gap, so the whole gap is grabbable.
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
 * The gap from `frame`'s `edge` side to `other`, as a one-item list, or empty
 * when `other` is not beside that side.
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
