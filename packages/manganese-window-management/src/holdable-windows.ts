import type { HoldableWindow } from "./AgentSeats";
import type { DrawnWindow } from "./useWindowMotion";
import { browserIdOf, WindowKind } from "./window";
import { isMoving } from "./window-motion";

/**
 * The windows an agent's ring, pointer or the user's strip can be drawn
 * over: on screen, shown rather than behind a tab, and at rest, so nothing
 * trails a window as it moves. A client window goes by its app id and a
 * browser window by the engine's id for it, which are what seats name.
 */
export const holdableWindows = (
  drawn: readonly DrawnWindow[],
): readonly HoldableWindow[] =>
  drawn.flatMap(({ motion, placement, window }) => {
    if (placement?.surface === undefined || isMoving(motion)) {
      return [];
    }
    const appId =
      window.kind === WindowKind.App ? window.appId : browserIdOf(window.id);
    return appId === undefined
      ? []
      : [{ appId, depth: placement.depth, frame: placement.frame }];
  });
