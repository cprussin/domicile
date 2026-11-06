import type { ComponentProps } from "react";

import { TitleBar } from "./TitleBar";
import type { Aim, DropTargets } from "./tiled/aim";
import { useTileDrag } from "./tiled/useTileDrag";
import type { Layout } from "./tree/node";
import type { NodeRef } from "./tree/path";

/** The primary button, as `PointerEvent.button` numbers it. */
const PRIMARY_BUTTON = 0;

type Props = Omit<
  ComponentProps<typeof TitleBar>,
  "grabbing" | "group" | "onPointerDown"
> & {
  /** The group's layout and the windows it holds. */
  group: { layout: Layout; windows: readonly string[] };
  /** The group. */
  node: NodeRef;
  /** Where the dragged group would land if dropped now. */
  onAim: (aim: Aim | undefined) => void;
  onDrop: () => void;
  /** The group dropped where it was aimed. See `useTileDrag`. */
  onDropOn: (aim: Aim) => void;
  /** The group taken hold of. */
  onGrab: () => void;
  /** A press on the tab, which shows the group. */
  onPress: () => void;
  /** A move of the group was pulled. See `useTileDrag`. */
  onPull: () => void;
  /** What the group can be dropped on, on every screen. */
  targets: DropTargets;
};

/**
 * The tab of a group nested in another group's strip. A press shows the
 * group, and a drag with the primary button moves it as a tiled window's tab
 * moves: along its strip, or out to another strip, window or screen.
 */
export const GroupTitleBar = ({
  node,
  onAim,
  onDrop,
  onDropOn,
  onGrab,
  onPress,
  onPull,
  targets,
  ...bar
}: Props) => {
  const { drag, onPointerDown } = useTileDrag({
    dragged: { node, windows: bar.group.windows },
    frame: bar.rect,
    onAim,
    onDrop,
    onDropOn,
    onGrab,
    onPull,
    onStretch: doesNotStretch,
    resizes: false,
    targets,
  });
  return (
    <TitleBar
      {...bar}
      grabbing={drag?.pulled === true}
      onPointerDown={(event) => {
        onPress();
        if (event.button === PRIMARY_BUTTON) {
          onPointerDown(event);
        }
      }}
    />
  );
};

/** Never called: a tab only moves its group. */
const doesNotStretch = () => {
  throw new Error("group title bar: a tab does not resize its group");
};
