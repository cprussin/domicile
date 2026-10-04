import { Direction } from "../window-management/direction";
import type { Rect } from "../window-management/rect";

/** A screen and its position on the desktop. */
export type PlacedScreen = {
  /** Its rectangle, in the host's pixels. */
  box: Rect;
  /** The display name, matched by `<Screen name>`. */
  name: string;
};

/**
 * The screen `focus <direction>` moves to from `from`, or `undefined` for none.
 *
 * Follows sway (wlroots): of the screens wholly past that edge, the one nearest
 * this screen's center.
 */
export const screenToward = (
  screens: readonly PlacedScreen[],
  from: string,
  direction: Direction,
): string | undefined => {
  const here = screens.find(({ name }) => name === from);
  if (here === undefined) {
    throw new Error(`shell: no screen ${from}`);
  } else {
    const middle = middleOf(here.box);
    return screens
      .filter(({ box }) => lies(box, here.box, direction))
      .toSorted(
        (one, other) => distance(one.box, middle) - distance(other.box, middle),
      )[0]?.name;
  }
};

/** Whether `box` is wholly past `from`'s edge on the `direction` side. */
const lies = (box: Rect, from: Rect, direction: Direction): boolean => {
  switch (direction) {
    case Direction.Left: {
      return box.x + box.width <= from.x;
    }
    case Direction.Down: {
      return box.y >= from.y + from.height;
    }
    case Direction.Up: {
      return box.y + box.height <= from.y;
    }
    case Direction.Right: {
      return box.x >= from.x + from.width;
    }
  }
};

const middleOf = (box: Rect): readonly [x: number, y: number] => [
  box.x + box.width / 2,
  box.y + box.height / 2,
];

/** The squared distance from `point` to the nearest point of `box`. */
const distance = (
  box: Rect,
  [x, y]: readonly [x: number, y: number],
): number => {
  const dx = Math.min(Math.max(x, box.x), box.x + box.width) - x;
  const dy = Math.min(Math.max(y, box.y), box.y + box.height) - y;
  return dx * dx + dy * dy;
};
