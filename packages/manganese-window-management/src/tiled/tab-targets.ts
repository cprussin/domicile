import type { Screenful } from "../placement";
import type { TabTarget } from "./aim";

/**
 * Every tab a screen shows, hidden ones too, which a window or group can be
 * dropped beside: each window's tab, and each nested group's tab in the strip
 * around it.
 */
export const tabTargetsOf = ({
  placements,
  tabs,
}: Pick<Screenful, "placements" | "tabs">): readonly TabTarget[] => [
  ...placements.flatMap(({ bar, depth, id, strip, tabbed }) =>
    strip !== undefined && tabbed !== undefined
      ? [
          {
            at: strip.at,
            depth,
            node: { id, up: 0 },
            rect: bar,
            strip: strip.box,
            tabbed,
            windows: [id],
          },
        ]
      : [],
  ),
  ...tabs.map(({ depth, node, rect, strip, tabbed, windows }) => ({
    at: strip.at,
    depth,
    node,
    rect,
    strip: strip.box,
    tabbed,
    windows,
  })),
];
