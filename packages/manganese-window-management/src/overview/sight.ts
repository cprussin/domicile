// How the stage draws each window while the overview shows: through its
// workspace's tile.

import type { Placement } from "../placement";
import type { ScreenOverview } from "./overview";
import type { View } from "./tiles";
import { viewOf } from "./tiles";

/**
 * A window seen through a tile. A hidden workspace's windows fade in as the
 * overview opens (`showing`) and out as it closes (`fading`).
 */
export type Seen = { fading: boolean; showing: boolean; view: View };

/** A hidden workspace's window, drawn only in the overview. */
export type HiddenSeen = { placement: Placement; screen: string; seen: Seen };

/** Everything the stage draws differently while the overview shows. */
export type OverviewSight = {
  /** How each screen's shown workspace is seen, by screen. */
  shown: ReadonlyMap<string, Seen>;
  /** The windows of hidden workspaces, by id. */
  hidden: ReadonlyMap<string, HiddenSeen>;
};

/** The view of a screen at its full size. */
const FULL: View = { scale: 1, x: 0, y: 0 };

/**
 * How the stage draws `overviews`. Closing, the shown workspace grows back to
 * fill its screen and the hidden ones fade where they are.
 */
export const sightOf = (
  overviews: readonly ScreenOverview[],
): OverviewSight => ({
  hidden: new Map(
    overviews.flatMap(({ closing, others, screen, tiles }) =>
      others.flatMap(({ name, placements }) => {
        const tile = tiles.find((found) => found.name === name);
        if (tile === undefined) {
          throw new Error(`shell: workspace ${name} has no overview tile`);
        } else {
          const seen = {
            fading: closing,
            showing: !closing,
            view: viewOf(screen.geometry.screen, tile.box),
          };
          return placements.map(
            (placement) =>
              [
                placement.id,
                { placement, screen: screen.geometry.name, seen },
              ] as const,
          );
        }
      }),
    ),
  ),
  shown: new Map(
    overviews.map(({ closing, screen, tiles }) => {
      const tile = tiles.find(({ name }) => name === screen.current);
      if (tile === undefined) {
        throw new Error(
          `shell: workspace ${screen.current} has no overview tile`,
        );
      } else {
        return [
          screen.geometry.name,
          {
            fading: false,
            showing: false,
            view: closing ? FULL : viewOf(screen.geometry.screen, tile.box),
          },
        ] as const;
      }
    }),
  ),
});
