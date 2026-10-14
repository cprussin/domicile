// The boxes floats cover, which hide the drop targets behind them.

import { spanning } from "../rect";
import type { StageScreen } from "../screens/stage-screens";
import type { FloatCover } from "../tiled/aim";
import type { Tab } from "../tree/frames";
import { windowsIn } from "../tree/node";
import type { Float } from "./float";

/**
 * Each float's box, spanning its windows' frames and the strips and wells of
 * any group shown in a tab, which hides the targets behind it. Excludes
 * fullscreen screens, as `tabTargets` does.
 */
export const floatCovers = (
  screens: readonly StageScreen[],
): readonly FloatCover[] =>
  screens
    .filter(({ fullscreen }) => fullscreen === undefined)
    .flatMap(({ floats, screenful }) =>
      floats.flatMap((float) => {
        const windows = windowsIn(float.root);
        const inside = screenful.placements.filter(({ id }) =>
          windows.includes(id),
        );
        // A group shown in a tab is inset in its well, which is the float's
        // edge there.
        const wells = screenful.tabs.flatMap(({ id, strip, well }) =>
          well === undefined || !windows.includes(id) ? [] : [strip.box, well],
        );
        const [first, ...rest] = inside;
        return first === undefined
          ? []
          : [
              {
                depth: first.depth,
                frame: [...rest.map(({ frame }) => frame), ...wells].reduce(
                  spanning,
                  first.frame,
                ),
                windows,
              },
            ];
      }),
    );

/**
 * Whether `tab`'s well casts `float`'s shadow: it is in a float, and no other
 * shown well among `tabs` holds it. The float's windows cast their own shadows
 * (see `FloatShadow`), but the outermost well covers those inside it; one
 * inside another would shade the outer one.
 */
export const castsFloatShadow = (
  float: Float | undefined,
  tab: Tab,
  tabs: readonly Tab[],
): boolean =>
  float !== undefined && !tabs.some((other) => holdsWell(other, tab));

/** Whether `outer`'s well holds `inner`'s: it is shown and holds more. */
const holdsWell = (outer: Tab, inner: Tab): boolean =>
  outer.well !== undefined &&
  outer.strip.group.windows.length > inner.strip.group.windows.length &&
  inner.strip.group.windows.every((id) =>
    outer.strip.group.windows.includes(id),
  );
