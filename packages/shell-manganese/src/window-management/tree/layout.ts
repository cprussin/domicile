// `splith`, `splitv`, `layout tabbed`, `layout stacking` and `layout toggle
// split`: how the container around the focus is arranged.
//
// Which container that is follows sway: a split wraps whatever the focus is
// pointed at, and a layout rearranges the container the focus is *in* — its
// parent, where the focus is a window, and itself where `focus parent` has
// selected one. A workspace holding a single window has no container at all,
// so a layout command gives it one, the way sway's workspace container is
// always there.

import type { Axis } from "../direction";
import type { LayoutNode } from "./node";
import { Layout, LayoutNode as Node, NodeKind, splitFor } from "./node";
import { nodeAt, replacedAt } from "./path";
import type { Tiling } from "./tiling";
import { focusPathOf, withCommandsOn } from "./tiling";

/** `splith` / `splitv`: the focus wrapped in a container of one. */
export const split = (tiling: Tiling, axis: Axis): Tiling =>
  rearranged(tiling, (root, path) =>
    replacedAt(root, path, (node) => Node.Container(splitFor(axis), [node])),
  );

/** `layout tabbed` / `layout stacking`: the container around the focus. */
export const laidOut = (tiling: Tiling, layout: Layout): Tiling =>
  rearranged(tiling, (root, path) => relaid(root, path, () => layout));

/** `layout toggle split`: a row becomes a column, and anything else a row. */
export const splitToggled = (tiling: Tiling): Tiling =>
  rearranged(tiling, (root, path) =>
    relaid(root, path, (was) =>
      was === Layout.SplitH ? Layout.SplitV : Layout.SplitH,
    ),
  );

// The container the focus is in, given a new layout. Where the focus is a
// window with no container of its own — a workspace holding one window — it
// gets one, which is the container sway's workspace always has.
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
      // A workspace of one window: the layout it is given is the container it
      // did not have, and `SplitH` is what a toggle reads as the layout it was
      // not in.
      return replacedAt(root, parent, (node) =>
        Node.Container(into(Layout.SplitH), [node]),
      );
    }
  }
};

// Every command here changes the shape around the focus and none of them move
// it, so each is the same two steps: edit the tree, then point the commands
// back at what they were on — the chain through it is a level longer or
// shorter than it was. At what they were on rather than at the window inside
// it, because a split of a selected container leaves that container selected.
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
