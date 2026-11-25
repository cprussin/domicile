import type { HoldableWindow } from "./AgentSeats";
import type { DrawnWindow } from "./useWindowMotion";
import { WindowKind } from "./window";
import { isMoving } from "./window-motion";

/**
 * The client windows an agent's ring, pointer or the user's strip can be
 * drawn over: on screen, shown rather than behind a tab, and at rest, so
 * nothing trails a window as it moves. Browser windows are left out, since
 * agent seats hold client windows only.
 */
export const holdableWindows = (
  drawn: readonly DrawnWindow[],
): readonly HoldableWindow[] =>
  drawn.flatMap(({ motion, placement, window }) =>
    window.kind === WindowKind.App &&
    placement?.surface !== undefined &&
    !isMoving(motion)
      ? [
          {
            appId: window.appId,
            depth: placement.depth,
            frame: placement.frame,
          },
        ]
      : [],
  );
