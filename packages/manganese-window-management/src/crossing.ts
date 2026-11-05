// Detects tiled windows that moved to another tab group, so the page can draw
// them over the tab strips they slide past.
//
// Tiled windows and strips share a depth, and strips come after every
// window's contents in the document, so a window easing into another group
// would slide under each strip on its way. No event announces a move, so this
// compares two renders.

import type { Placement } from "./placement";
import { TILED } from "./placement";
import type { Shown } from "./shown";

/** What each screen shows, by screen name. */
type Desk = Readonly<Record<string, Shown>>;

/**
 * The shown tiled windows that share their group with none of the windows
 * they shared it with in `before`.
 *
 * A window moving along its own strip keeps its group, as does a group that
 * another window joins. A window shown on a screen whose workspace changed
 * slides with its workspace instead.
 */
export const crossed = (before: Desk, shown: Desk): ReadonlySet<string> => {
  const was = new Map(
    Object.values(before).flatMap(({ placements }) =>
      placements.map((placement) => [placement.id, placement] as const),
    ),
  );
  return new Set(
    Object.entries(shown).flatMap(([name, { current, placements }]) =>
      before[name]?.current === current
        ? placements
            .filter((placement) => {
              const then = was.get(placement.id);
              return then !== undefined && leftGroup(then, placement);
            })
            .map(({ id }) => id)
        : [],
    ),
  );
};

/**
 * Whether a tiled window placed at `then` and shown at `now` shares its group
 * with none of the windows it shared it with before.
 */
const leftGroup = (then: Placement, now: Placement): boolean => {
  const before = othersIn(then);
  const after = othersIn(now);
  return (
    now.surface !== undefined &&
    then.depth === TILED &&
    now.depth === TILED &&
    before !== undefined &&
    after !== undefined &&
    before.length + after.length > 0 &&
    !after.some((id) => before.includes(id))
  );
};

/** The other windows in a placed window's group, or `undefined` for none. */
const othersIn = ({ id, strip }: Placement): readonly string[] | undefined =>
  strip?.group.windows.filter((other) => other !== id);
