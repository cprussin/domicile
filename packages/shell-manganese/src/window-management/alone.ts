import type { Screenful } from "./placement";

/**
 * Whether the screen shows one thing alone: a single window, or a single tab
 * group. Neither the ring nor a frame in the accent is drawn then, because
 * there is nothing on the screen for them to pick it out from.
 *
 * Counted by the windows whose contents are on screen, which is one for a tab
 * group however many tabs it has: the windows its tabs hide have none.
 */
export const showsOneThing = ({ placements }: Screenful): boolean =>
  placements.filter(({ surface }) => surface !== undefined).length === 1;
