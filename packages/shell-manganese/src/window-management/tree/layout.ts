// Layout commands: `splith`, `splitv`, `layout tabbed`, `layout stacking` and
// `layout toggle split`.
//
// As in sway, a split wraps the focused node, and a layout changes the
// container the focus is in (the node itself if `focus parent` selected a
// container). A lone window gets a container, since sway always has a
// workspace container.

import type { Axis } from "../direction";
import type { LayoutNode } from "./node";
import { Layout, LayoutNode as Node, NodeKind, splitFor } from "./node";
import { nodeAt, replacedAt } from "./path";
import type { Tiling } from "./tiling";
import { focusPathOf, withCommandsOn } from "./tiling";

/** `splith` / `splitv`: wraps the focus in a one-child container. */
export const split = (tiling: Tiling, axis: Axis): Tiling =>
  rearranged(tiling, (root, path) =>
    replacedAt(root, path, (node) => Node.Container(splitFor(axis), [node])),
  );

/** `layout tabbed` / `layout stacking` on the container around the focus. */
export const laidOut = (tiling: Tiling, layout: Layout): Tiling =>
  rearranged(tiling, (root, path) => relaid(root, path, () => layout));

/** `layout toggle split`: a row becomes a column, and anything else a row. */
export const splitToggled = (tiling: Tiling): Tiling =>
  rearranged(tiling, (root, path) =>
    relaid(root, path, (was) =>
      was === Layout.SplitH ? Layout.SplitV : Layout.SplitH,
    ),
  );

// Gives the container around the focus a new layout, creating one for a lone
// window.
const relaid = (
  root: LayoutNode,
  path: readonly number[],
  into: (was: Layout) => Layout,
): LayoutNode => {
  const focused = nodeAt(root, path);
  if (focused.kind === NodeKind.Container) {
    return replacedAt(root, path, () =>
      Node.Container(
        into(focused.layout),
        focused.children,
        focused.focused,
        focused.fractions,
      ),
    );
  } else {
    const parent = path.slice(0, -1);
    const around = nodeAt(root, parent);
    if (around.kind === NodeKind.Container) {
      return replacedAt(root, parent, () =>
        Node.Container(
          into(around.layout),
          around.children,
          around.focused,
          around.fractions,
        ),
      );
    } else {
      // A lone window gets a new container. A toggle treats it as `SplitH`.
      return replacedAt(root, parent, (node) =>
        Node.Container(into(Layout.SplitH), [node]),
      );
    }
  }
};

// Edits the tree, then re-points the commands at the same node, whose depth
// may have changed. Re-points at the node, not its window, so a split keeps a
// selected container selected.
const rearranged = (
  tiling: Tiling,
  into: (root: LayoutNode, path: readonly number[]) => LayoutNode,
): Tiling => {
  const { root } = tiling;
  if (root === undefined) {
    return tiling;
  } else {
    const path = focusPathOf(root, tiling.depth);
    const focused = nodeAt(root, path);
    return withCommandsOn({ ...tiling, root: into(root, path) }, focused);
  }
};
