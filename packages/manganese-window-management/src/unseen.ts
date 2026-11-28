// Where the stage lays out a captured window that no screen shows, so its
// page keeps drawing for the capture.

import type { Seen } from "./overview/sight";
import type { Placement } from "./placement";
import { placementsOf, UNSEEN } from "./placement";
import type { StageScreen } from "./screens/stage-screens";
import type { WindowState } from "./window-state";
import { workspaceNamed, workspacesOn } from "./window-state";
import { windowsOn } from "./workspace";

/** A captured window on a hidden workspace, laid out where nobody sees it. */
export type Unseen = { placement: Placement; screen: string; seen: Seen };

/**
 * How an unseen window is seen: where it is, and never by the pointer, which
 * the wallpaper over it lets through.
 */
const SEEN: Seen = {
  arriving: undefined,
  fading: false,
  shut: true,
  view: { scale: 1, x: 0, y: 0 },
};

/**
 * Where each of the `captured` windows that a hidden workspace holds is laid
 * out, by id: as it would be on its workspace's screen, under the wallpaper.
 *
 * A page with no layout box draws nothing, so a screenshot or screen cast of
 * a window on another workspace would wait for a frame that never comes. A
 * background tab is laid out under the tab in front of it (see `contentsOf`);
 * a hidden workspace has nothing in front, so its captured windows go under
 * the wallpaper. A hidden tab among them is drawn at its tab's place.
 */
export const unseenOf = (
  state: Pick<WindowState, "homes" | "workspaces">,
  screens: readonly StageScreen[],
  captured: ReadonlySet<string>,
): ReadonlyMap<string, Unseen> =>
  new Map(
    captured.size === 0
      ? []
      : screens.flatMap(({ current, geometry }) =>
          workspacesOn(state, geometry.name)
            .filter((name) => name !== current)
            .map((name) => workspaceNamed(state, name))
            .filter((workspace) =>
              windowsOn(workspace).some((id) => captured.has(id)),
            )
            .flatMap(
              (workspace) => placementsOf(workspace, geometry, 0).placements,
            )
            .filter(({ id }) => captured.has(id))
            .map(
              (placement) =>
                [
                  placement.id,
                  {
                    placement: {
                      ...placement,
                      behind: undefined,
                      depth: UNSEEN,
                      surface: placement.surface ?? placement.behind,
                    },
                    screen: geometry.name,
                    seen: SEEN,
                  },
                ] as const,
            ),
        ),
  );
