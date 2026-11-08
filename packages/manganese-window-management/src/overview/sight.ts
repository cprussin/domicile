// How the stage draws each window while the overview shows: through its
// workspace's tile.

import type { Placement } from "../placement";
import type { ScreenOverview } from "./overview";
import { cameraOf, shownViewOf } from "./overview";
import type { View } from "./tiles";
import { composed, viewOf } from "./tiles";

/**
 * A window seen through a tile. A hidden workspace's windows arrive, as the
 * overview opens, from where they sat beside the shown workspace
 * (`arriving`), and fade as it closes (`fading`).
 */
export type Seen = {
  arriving: View | undefined;
  fading: boolean;
  view: View;
};

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
 * How the stage draws `overviews`, as one camera on each screen pulling back
 * from its shown workspace. The shown workspace shrinks into its tile, and
 * the hidden ones come in from beside it. Closing, the camera pushes back
 * into the shown workspace, which grows to fill its screen while the rest
 * leave beside it.
 */
export const sightOf = (
  overviews: readonly ScreenOverview[],
): OverviewSight => ({
  hidden: new Map(
    overviews.flatMap((overview) => {
      const { closing, others, screen, tiles } = overview;
      const camera = cameraOf(overview);
      return others.flatMap(({ name, placements }) => {
        const tile = tiles.find((found) => found.name === name);
        if (tile === undefined) {
          throw new Error(`shell: workspace ${name} has no overview tile`);
        } else {
          const view = viewOf(screen.geometry.screen, tile.box);
          const beside = composed(camera, view);
          const seen = {
            arriving: closing ? undefined : beside,
            fading: closing,
            view: closing ? beside : view,
          };
          return placements.map(
            (placement) =>
              [
                placement.id,
                { placement, screen: screen.geometry.name, seen },
              ] as const,
          );
        }
      });
    }),
  ),
  shown: new Map(
    overviews.map((overview) => [
      overview.screen.geometry.name,
      {
        arriving: undefined,
        fading: false,
        view: overview.closing ? FULL : shownViewOf(overview),
      },
    ]),
  ),
});
