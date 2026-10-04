import type { Screenful } from "./placement";

/**
 * Whether all screens together show a single window or tab group. If so,
 * nothing is dimmed. See `Scrim`.
 *
 * Counts windows with visible contents, so a tab group counts once.
 */
export const showsOneThing = (screenfuls: readonly Screenful[]): boolean =>
  screenfuls.flatMap(({ placements }) =>
    placements.filter(({ surface }) => surface !== undefined),
  ).length === 1;
