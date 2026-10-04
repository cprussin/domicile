import type { Screenful } from "./placement";

/**
 * Whether the desk shows one thing alone: a single window, or a single tab
 * group, across every screen. Nothing is sunk under a scrim then — see
 * `Scrim` — because there is nothing on the desk to pick it out from. A
 * window alone on its screen is still picked out from one on the next.
 *
 * Counted by the windows whose contents are on screen, which is one for a tab
 * group however many tabs it has: the windows its tabs hide have none.
 */
export const showsOneThing = (screenfuls: readonly Screenful[]): boolean =>
  screenfuls.flatMap(({ placements }) =>
    placements.filter(({ surface }) => surface !== undefined),
  ).length === 1;
