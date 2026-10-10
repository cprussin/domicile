// One workspace: its tiling, the floats over it, and which layer has the
// keyboard.
//
// As in sway, floats are not in the tree, so the workspace tracks the tree's
// focus and the focused float separately. Keyed commands go through here to
// reach the layer with the keyboard. See
// `packages/shell-manganese/docs/WINDOW-MANAGEMENT.md`.

import type { Axis, Direction } from "./direction";
import type { Float } from "./floating/float";
import {
  floatAskedFor,
  floatFor,
  floatHolds,
  grown,
  movedTo,
  retiled,
  scratchpadFloatFor,
  shifted,
  sizedTo,
} from "./floating/float";
import { INNER_GAP, tiledAreaOf } from "./gaps";
import type { Rect } from "./rect";
import { arrivedOn, droppedOn, tradedFor } from "./tree/drop";
import { enteredFrom, focusMoved, leavesBy } from "./tree/focus-direction";
import { inserted, insertedNode } from "./tree/insert";
import { laidOut, split, splitToggled } from "./tree/layout";
import { movedBy, pushedOff, pushedOn } from "./tree/move";
import type { LayoutNode } from "./tree/node";
import { Layout, LayoutNode as Node, NodeKind, windowsIn } from "./tree/node";
import type { NodeRef } from "./tree/path";
import { nodeAt, pathTo, pathToRef } from "./tree/path";
import { removed, removedAt } from "./tree/remove";
import { resized } from "./tree/resize";
import { stretched } from "./tree/stretch";
import type { Tiling } from "./tree/tiling";
import {
  focusChainOf,
  focusedChild,
  focusedIdOf,
  focusedNodeOf,
  focusedParent,
  focusedWindowIn,
  focusPathOf,
  NOTHING_TILED,
  shownOver,
  windowsOf,
  withCommandsOn,
  withCommandsOnWindow,
  withFocusOn,
} from "./tree/tiling";

/**
 * A window or group filling the screen, and how much of the desktop it fills.
 * A group is named by a window inside it, as a {@link NodeRef}.
 */
export type Fullscreen = NodeRef & {
  /** Whether it covers every screen rather than the one it is on. */
  global: boolean;
};

export type Workspace = {
  /** The floating windows in stacking order, back to front. */
  floats: readonly Float[];
  /**
   * The floating window with the keyboard, or `undefined` while the tiling
   * has it.
   *
   * A window id, not a layer flag, because a floating group holds several
   * windows.
   */
  floatFocus: string | undefined;
  /** The window or group filling the screen, or `undefined` when none is. */
  fullscreen: Fullscreen | undefined;
  /** The workspace's name in the config, `1` through `10`. */
  name: string;
  tiling: Tiling;
};

export const emptyWorkspace = (name: string): Workspace => ({
  floatFocus: undefined,
  floats: [],
  fullscreen: undefined,
  name,
  tiling: NOTHING_TILED,
});

/** Every window on the workspace: the tiled ones, then the floating ones. */
export const windowsOn = (workspace: Workspace): readonly string[] => [
  ...windowsOf(workspace.tiling),
  ...workspace.floats.flatMap(({ root }) => windowsIn(root)),
];

/** Whether this workspace is where the window `id` is. */
export const holds = (workspace: Workspace, id: string): boolean =>
  windowsOn(workspace).includes(id);

/** The focused float or tiled window, or `undefined` for an empty workspace. */
export const focusedOn = (workspace: Workspace): string | undefined =>
  workspace.floatFocus ?? focusedIdOf(workspace.tiling);

/** The box the floating window `id` sits in, or `undefined` when it is tiled. */
export const floatOn = (workspace: Workspace, id: string): Float | undefined =>
  workspace.floats.find((float) => floatHolds(float, id));

/**
 * The window a pointer over `id` is in: `id`, or the open tab when its
 * container hides it (see `shownOver`). Hovering a hidden tab does not select
 * it; clicking does. A fullscreen window always counts as shown.
 */
export const pointedOn = (workspace: Workspace, id: string): string => {
  const root = floatOn(workspace, id)?.root ?? workspace.tiling.root;
  if (workspace.fullscreen?.id === id) {
    return id;
  } else if (root === undefined) {
    throw new Error(`workspace ${workspace.name}: no window ${id} to point at`);
  } else {
    return shownOver(root, id);
  }
};

/**
 * Opens and focuses a window: into the focused floating group if there is
 * one, otherwise tiled beside the focus (as in sway, even over a lone float).
 */
export const opened = (workspace: Workspace, id: string): Workspace => {
  const floating = workspace.floatFocus;
  if (floating === undefined) {
    return tiledIn(workspace, id);
  } else {
    const float = floatHolding(workspace, floating);
    return float.root.kind === NodeKind.Container
      ? {
          ...withFloat(workspace, floating, () =>
            retiled(float, (tiling) => inserted(tiling, id)),
          ),
          floatFocus: id,
        }
      : tiledIn(workspace, id);
  }
};

/** A window arriving in the tiling beside its focus, and focused. */
const tiledIn = (workspace: Workspace, id: string): Workspace => ({
  ...workspace,
  floatFocus: undefined,
  floats: onWindows(workspace.floats),
  tiling: inserted(workspace.tiling, id),
});

/** The same for a whole node, such as a group sent from another workspace. */
export const nodeTiledIn = (
  workspace: Workspace,
  node: LayoutNode,
): Workspace => ({
  ...workspace,
  floatFocus: undefined,
  floats: onWindows(workspace.floats),
  tiling: insertedNode(workspace.tiling, node),
});

/**
 * `move container to workspace <name>`: the node leaving and the workspace
 * without it. A `focus parent` selection leaves whole; a float leaves as its
 * focused window. `undefined` on an empty workspace.
 */
export const sentOff = (
  workspace: Workspace,
): { node: LayoutNode; rest: Workspace } | undefined => {
  const { floatFocus, tiling } = workspace;
  if (floatFocus !== undefined) {
    return {
      node: Node.Window(floatFocus),
      rest: closed(workspace, floatFocus),
    };
  } else if (tiling.root === undefined) {
    return undefined;
  } else {
    const node = focusedNodeOf(tiling);
    return {
      node,
      rest: fullscreenKept(workspace, {
        ...workspace,
        tiling: removedAt(tiling.root, focusPathOf(tiling.root, tiling.depth)),
      }),
    };
  }
};

/**
 * The workspace without the window `id`, wherever it was.
 *
 * Keeps the rest of a fullscreen group fullscreen (see {@link keptFrom}), and
 * moves the keyboard to a window that still exists.
 */
export const closed = (workspace: Workspace, id: string): Workspace => {
  const from = floatOn(workspace, id);
  const left = from === undefined ? undefined : floatWithout(from, id);
  const floats = workspace.floats
    .map((float) => (float === from ? left : float))
    .filter((float) => float !== undefined);
  const rest = {
    ...workspace,
    // Focus the rest of its group, else the front float, else the tiling.
    floatFocus:
      workspace.floatFocus === id
        ? focusIn(left ?? floats.at(-1))
        : workspace.floatFocus,
    floats,
    tiling: removed(workspace.tiling, id),
  };
  return fullscreenKept(workspace, rest);
};

/**
 * Focuses the window `id` after a click, a tab press or the pointer entering
 * it. A float is also raised.
 */
export const reached = (workspace: Workspace, id: string): Workspace => {
  if (floatOn(workspace, id) === undefined) {
    return focusedTiled(workspace, id);
  } else {
    const focused = floatFocused(workspace, id);
    return {
      ...focused,
      floats: [
        ...focused.floats.filter((float) => !floatHolds(float, id)),
        ...focused.floats.filter((float) => floatHolds(float, id)),
      ],
    };
  }
};

/**
 * `floating toggle`: floats the focused window or `focus parent` selection, or
 * tiles the focused float. A new float is sized to fit `screen` (see
 * `floatFor`).
 */
export const floatToggled = (workspace: Workspace, screen: Rect): Workspace => {
  const { floatFocus, tiling } = workspace;
  if (floatFocus !== undefined) {
    const float = floatHolding(workspace, floatFocus);
    return {
      ...workspace,
      floatFocus: undefined,
      floats: workspace.floats.filter((found) => found !== float),
      tiling: insertedNode(tiling, untabbed(float.root)),
    };
  } else if (tiling.root === undefined) {
    return workspace;
  } else {
    const node = focusedNodeOf(tiling);
    return {
      ...workspace,
      floatFocus: focusedWindowIn(node),
      floats: [
        ...workspace.floats,
        floatFor(tabbed(node), workspace.floats.length, screen),
      ],
      // Not {@link floatFocused}: `removedAt` already leaves the tiling's
      // focus on a window.
      tiling: removedAt(tiling.root, focusPathOf(tiling.root, tiling.depth)),
    };
  }
};

/** `node` as a float's root: a lone window goes in a tabbed container. */
const tabbed = (node: LayoutNode): LayoutNode =>
  node.kind === NodeKind.Window ? Node.Container(Layout.Tabbed, [node]) : node;

/** A float's root going back to the tiling, out of a one-child container. */
const untabbed = (node: LayoutNode): LayoutNode => {
  if (node.kind === NodeKind.Container) {
    const [only, ...others] = node.children;
    return only !== undefined && others.length === 0 ? only : node;
  } else {
    return node;
  }
};

/** Shows a scratchpad window as the front float. See `scratchpadFloatFor`. */
export const shown = (
  workspace: Workspace,
  id: string,
  screen: Rect,
): Workspace => ({
  ...floatFocused(workspace, id),
  floats: [...workspace.floats, scratchpadFloatFor(Node.Window(id), screen)],
});

/**
 * Opens a window as the focused front float at its requested size (see
 * `floatAskedFor`).
 */
export const openedFloating = (
  workspace: Workspace,
  id: string,
  screen: Rect,
  width: number,
  height: number,
): Workspace =>
  floatFocused(
    {
      ...workspace,
      floats: [
        ...workspace.floats,
        floatAskedFor(
          Node.Window(id),
          workspace.floats.length,
          screen,
          width,
          height,
        ),
      ],
    },
    id,
  );

/** `focus mode_toggle`: moves the keyboard between tiling and floats. */
export const modeToggled = (workspace: Workspace): Workspace => {
  if (workspace.floatFocus === undefined) {
    // The front float is the one last raised.
    const front = focusIn(workspace.floats.at(-1));
    return front === undefined ? workspace : floatFocused(workspace, front);
  } else {
    // Back to the tiling, if it has any windows.
    return focusedIdOf(workspace.tiling) === undefined
      ? workspace
      : {
          ...workspace,
          floatFocus: undefined,
          floats: onWindows(workspace.floats),
        };
  }
};

/** `focus <direction>` within the tiling or the focused floating group. */
export const focusStepped = (
  workspace: Workspace,
  direction: Direction,
): Workspace => inLayer(workspace, (tiling) => focusMoved(tiling, direction));

/**
 * Whether `focus <direction>` leaves this workspace for the next screen (see
 * `tree/focus-direction.ts`).
 *
 * Always from a fullscreen window, never from a global fullscreen one, and
 * never from a float (as in sway).
 */
export const focusLeaves = (
  workspace: Workspace,
  direction: Direction,
): boolean => {
  const { fullscreen } = workspace;
  if (fullscreen === undefined) {
    return (
      workspace.floatFocus === undefined &&
      leavesBy(workspace.tiling, direction)
    );
  } else {
    return !fullscreen.global;
  }
};

/**
 * The workspace after `focus <direction>` enters it from a neighboring
 * screen.
 *
 * A fullscreen window keeps the keyboard. Otherwise, as in sway, focus lands
 * on a window rather than an earlier `focus parent` selection.
 */
export const enteredBy = (
  workspace: Workspace,
  direction: Direction,
): Workspace => {
  const id = enteredFrom(workspace.tiling, direction);
  if (workspace.fullscreen !== undefined || id === undefined) {
    return workspace;
  } else {
    return {
      ...workspace,
      floatFocus: undefined,
      floats: onWindows(workspace.floats),
      tiling: withFocusOn(workspace.tiling, id),
    };
  }
};

/**
 * `focus parent` and `focus child`, in the tiling or in a floating group. A
 * lone floating window has no container around it, so there they do nothing.
 */
export const parentFocused = (workspace: Workspace): Workspace =>
  inLayer(workspace, focusedParent);

export const childFocused = (workspace: Workspace): Workspace =>
  inLayer(workspace, focusedChild);

/** `move <direction>`: through the tree, or a float by ten pixels. */
export const windowMoved = (
  workspace: Workspace,
  direction: Direction,
): Workspace =>
  reshaped(
    workspace,
    (float) => shifted(float, direction),
    (tiling) => movedBy(tiling, direction),
  );

/**
 * `move <direction>` off the workspace's edge: the focused tiled node and the
 * workspace without it. `undefined` when it moves within the tiling, or a
 * float or fullscreen window has the keyboard.
 */
export const pushedOffBy = (
  workspace: Workspace,
  direction: Direction,
): { node: LayoutNode; rest: Workspace } | undefined => {
  const leaving =
    workspace.floatFocus === undefined && workspace.fullscreen === undefined
      ? pushedOff(workspace.tiling, direction)
      : undefined;
  return leaving === undefined
    ? undefined
    : { node: leaving.node, rest: { ...workspace, tiling: leaving.rest } };
};

/**
 * The workspace with `node`, pushed off a neighboring screen's workspace
 * moving `direction`, tiled and focused.
 */
export const pushedOnBy = (
  workspace: Workspace,
  node: LayoutNode,
  direction: Direction,
): Workspace => ({
  ...workspace,
  floatFocus: undefined,
  floats: onWindows(workspace.floats),
  tiling: pushedOn(workspace.tiling, node, direction),
});

/** `resize`: a tiled window's share, or a float's box by ten pixels. */
export const windowGrown = (
  workspace: Workspace,
  direction: Direction,
): Workspace =>
  reshaped(
    workspace,
    (float) => grown(float, direction),
    (tiling) => resized(tiling, direction),
  );

/** `splith` / `splitv` on the focused window's own box. */
export const containerSplit = (workspace: Workspace, axis: Axis): Workspace =>
  inLayer(workspace, (tiling) => split(tiling, axis));

/** `layout tabbed` / `layout stacking` on the container around the focus. */
export const containerLaidOut = (
  workspace: Workspace,
  layout: Layout,
): Workspace => inLayer(workspace, (tiling) => laidOut(tiling, layout));

/** `layout toggle split`. */
export const splitFlipped = (workspace: Workspace): Workspace =>
  inLayer(workspace, splitToggled);

/**
 * `fullscreen` / `fullscreen toggle global` on the focused window or
 * `focus parent` selection.
 */
export const fullscreenToggled = (
  workspace: Workspace,
  global: boolean,
): Workspace => {
  const target = commandedOn(workspace);
  const was = workspace.fullscreen;
  if (target === undefined) {
    return workspace;
  } else if (
    was !== undefined &&
    was.global === global &&
    sameNode(workspace, was, target)
  ) {
    return { ...workspace, fullscreen: undefined };
  } else {
    return { ...workspace, fullscreen: { ...target, global } };
  }
};

/**
 * The fullscreen window or group as a tiling of its own, and whether it fills
 * every screen. `undefined` when none is fullscreen. Commands target inside it
 * as they do in its tiling or float.
 */
export const fullscreenOn = (
  workspace: Workspace,
): { global: boolean; tiling: Tiling } | undefined => {
  const { fullscreen } = workspace;
  if (fullscreen === undefined) {
    return undefined;
  } else {
    const layer = floatOn(workspace, fullscreen.id) ?? workspace.tiling;
    const root = rootHolding(workspace, fullscreen.id);
    const path = pathToRef(root, fullscreen);
    const node = nodeAt(root, path);
    // Whether the keyboard is inside it, so a selection inside it carries over.
    const focused =
      focusChainOf(root).slice(0, path.length).join() === path.join();
    return {
      global: fullscreen.global,
      tiling: {
        // A selection above it selects all of it.
        depth: focused
          ? Math.max(0, layer.depth - path.length)
          : focusChainOf(node).length,
        root: node,
      },
    };
  }
};

/**
 * `after`, a change to `before`, with the fullscreen it kept. See
 * {@link keptFrom}. A fullscreen `after` set itself is kept as is.
 */
export const fullscreenKept = (
  before: Workspace,
  after: Workspace,
): Workspace => {
  const was = before.fullscreen;
  const kept =
    was === undefined || after.fullscreen !== was
      ? after.fullscreen
      : keptFrom(before, after, was);
  // The same object when nothing changed, so React skips re-rendering.
  return kept === after.fullscreen ? after : { ...after, fullscreen: kept };
};

/** A floating window dragged to a new corner of the desktop. */
export const floatMoved = (
  workspace: Workspace,
  id: string,
  x: number,
  y: number,
): Workspace => withFloat(workspace, id, (float) => movedTo(float, x, y));

/**
 * Removes the whole float containing `id` after it is dragged to another
 * screen. Focus moves to the front float, or to the tiling if none is left.
 */
export const floatLifted = (workspace: Workspace, id: string): Workspace => {
  const float = floatHolding(workspace, id);
  const floats = workspace.floats.filter((found) => found !== float);
  const focus = workspace.floatFocus;
  return {
    ...workspace,
    floatFocus:
      focus !== undefined && floatHolds(float, focus)
        ? focusIn(floats.at(-1))
        : focus,
    floats,
  };
};

/** Adds a float dragged in from another screen as the focused front float. */
export const floatLanded = (workspace: Workspace, float: Float): Workspace =>
  floatFocused(
    { ...workspace, floats: [...workspace.floats, float] },
    focusedWindowIn(float.root),
  );

/** A floating window resized by dragging a corner. */
export const floatSized = (
  workspace: Workspace,
  id: string,
  { height, width, x, y }: Rect,
): Workspace =>
  withFloat(workspace, id, (float) =>
    sizedTo(movedTo(float, x, y), width, height),
  );

/**
 * Focuses the node `held` names, tiled or floating, with commands on it, as
 * `focus parent` would select it.
 */
export const nodeHeld = (workspace: Workspace, held: NodeRef): Workspace => {
  const float = floatOn(workspace, held.id);
  if (float === undefined) {
    return {
      ...workspace,
      floatFocus: undefined,
      tiling: withCommandsOn(workspace.tiling, tiledNodeOf(workspace, held)),
    };
  } else {
    const node = nodeAt(float.root, pathToRef(float.root, held));
    return withFloat(
      floatFocused(workspace, focusedWindowIn(node)),
      held.id,
      (focused) => retiled(focused, (tiling) => withCommandsOn(tiling, node)),
    );
  }
};

/**
 * A tiled window or group dragged onto a window and let go: onto its `edge`,
 * or its middle where that is `undefined` — see `tree/drop.ts`.
 */
export const tiledDropped = (
  workspace: Workspace,
  moving: NodeRef,
  target: string,
  edge: Direction | undefined,
): Workspace => ({
  ...workspace,
  floatFocus: undefined,
  tiling: droppedOn(workspace.tiling, moving, target, edge),
});

/**
 * The tiled node `moving` names, taken out to drop on another workspace, and
 * the workspace without it.
 */
export const tiledLifted = (
  workspace: Workspace,
  moving: NodeRef,
): { node: LayoutNode; rest: Workspace } => {
  const root = tiledRootOf(workspace, moving);
  const path = pathToRef(root, moving);
  return {
    node: nodeAt(root, path),
    rest: { ...workspace, tiling: removedAt(root, path) },
  };
};

/**
 * A tiled window or group dragged in from another workspace and dropped on
 * `target` — see `arrivedOn`.
 */
export const tiledArrived = (
  workspace: Workspace,
  node: LayoutNode,
  target: string,
  edge: Direction | undefined,
): Workspace => ({
  ...workspace,
  floatFocus: undefined,
  floats: onWindows(workspace.floats),
  tiling: arrivedOn(workspace.tiling, node, target, edge),
});

/**
 * The tiled node `moving` names swapped for `by`, from another workspace,
 * which it was dropped in the middle of.
 */
export const tiledTraded = (
  workspace: Workspace,
  moving: NodeRef,
  by: string,
): Workspace => ({
  ...workspace,
  tiling: tradedFor(workspace.tiling, moving, by),
});

/**
 * A tiled window's `edge` dragged `by` pixels, on a workspace laid out in
 * `area` — see `tree/stretch.ts`.
 */
export const tiledStretched = (
  workspace: Workspace,
  id: string,
  edge: Direction,
  by: number,
  area: Rect,
): Workspace => ({
  ...workspace,
  tiling: stretched(
    workspace.tiling,
    id,
    edge,
    by,
    tiledAreaOf(area),
    INNER_GAP,
  ),
});

// Focuses a floating window. Clears any `focus parent` selection in the tiling
// and other floats. Moves the group's own focus to the window, unless it is
// already there, so hovering does not undo `focus parent`.
const floatFocused = (workspace: Workspace, id: string): Workspace => ({
  ...workspace,
  floatFocus: id,
  floats: workspace.floats.map((float) => {
    if (!floatHolds(float, id)) {
      return retiled(float, withCommandsOnWindow);
    } else if (workspace.floatFocus === id) {
      return float;
    } else {
      return retiled(float, (tiling) => withFocusOn(tiling, id));
    }
  }),
  tiling: withCommandsOnWindow(workspace.tiling),
});

/**
 * Focuses a tiled window, taking the keyboard from any float.
 *
 * Returns the same object when the window already has focus. Refocusing would
 * undo `focus parent`, and clicks, `focusApp` replies and reconfigures all
 * refocus the current window often.
 */
const focusedTiled = (workspace: Workspace, id: string): Workspace =>
  workspace.floatFocus === undefined && focusedIdOf(workspace.tiling) === id
    ? workspace
    : {
        ...workspace,
        floatFocus: undefined,
        floats: onWindows(workspace.floats),
        tiling: withFocusOn(workspace.tiling, id),
      };

// Routes a keyed command to the focused layer: the float's box when a whole
// float is selected, otherwise the tree it is in.
const reshaped = (
  workspace: Workspace,
  float: (float: Float) => Float,
  tiling: (tiling: Tiling) => Tiling,
): Workspace => {
  const floating = workspace.floatFocus;
  if (floating === undefined) {
    return { ...workspace, tiling: tiling(workspace.tiling) };
  } else {
    const box = floatHolding(workspace, floating);
    return box.depth === 0 || windowsIn(box.root).length === 1
      ? withFloat(workspace, floating, float)
      : inLayer(workspace, tiling);
  }
};

// Applies a tree command to the tiling or to the focused float's tree.
const inLayer = (
  workspace: Workspace,
  into: (tiling: Tiling) => Tiling,
): Workspace => {
  const floating = workspace.floatFocus;
  if (floating === undefined) {
    return { ...workspace, tiling: into(workspace.tiling) };
  } else {
    const changed = retiled(floatHolding(workspace, floating), into);
    return {
      ...withFloat(workspace, floating, () => changed),
      floatFocus: focusedWindowIn(changed.root),
    };
  }
};

// Clears every float's `focus parent` selection once the keyboard leaves them.
const onWindows = (floats: readonly Float[]): readonly Float[] =>
  floats.map((float) => retiled(float, withCommandsOnWindow));

const withFloat = (
  workspace: Workspace,
  id: string,
  into: (float: Float) => Float,
): Workspace => {
  const held = floatHolding(workspace, id);
  return {
    ...workspace,
    floats: workspace.floats.map((float) =>
      float === held ? into(float) : float,
    ),
  };
};

/**
 * The node commands target, in the float with the keyboard or else the
 * tiling. `undefined` on an empty workspace.
 */
const commandedOn = (workspace: Workspace): NodeRef | undefined => {
  const { floatFocus } = workspace;
  const { depth, root } =
    floatFocus === undefined
      ? workspace.tiling
      : floatHolding(workspace, floatFocus);
  return root === undefined
    ? undefined
    : {
        id: focusedWindowIn(root),
        up: focusChainOf(root).length - focusPathOf(root, depth).length,
      };
};

/** Whether `a` and `b` name one node, tiled or floating. */
const sameNode = (workspace: Workspace, a: NodeRef, b: NodeRef): boolean => {
  const root = rootHolding(workspace, a.id);
  return (
    root === rootHolding(workspace, b.id) &&
    pathToRef(root, a).join() === pathToRef(root, b).join()
  );
};

/** The root of the tiling or float the window `id` is in. */
const rootHolding = (workspace: Workspace, id: string): LayoutNode => {
  const root = floatOn(workspace, id)?.root ?? workspace.tiling.root;
  if (root === undefined) {
    throw new Error(`workspace ${workspace.name}: no window ${id}`);
  } else {
    return root;
  }
};

/**
 * The fullscreen `was` of `before`, as it stands in `after`.
 *
 * A window stays fullscreen while it is on the workspace. A group keeps the
 * highest node over one of its windows that holds no window but its own and
 * any opened since, so it follows its windows through splits, moves and
 * closes. It ends with its last window.
 */
const keptFrom = (
  before: Workspace,
  after: Workspace,
  was: Fullscreen,
): Fullscreen | undefined => {
  const present = windowsOn(after);
  if (was.up === 0) {
    return present.includes(was.id) ? was : undefined;
  } else {
    const root = rootHolding(before, was.id);
    const opened = present.filter((id) => !holds(before, id));
    const own = [...windowsIn(nodeAt(root, pathToRef(root, was))), ...opened];
    const left = own.filter((id) => present.includes(id));
    const anchor = left.includes(was.id) ? was.id : left[0];
    if (anchor === undefined) {
      return undefined;
    } else {
      const up = ownedAbove(rootHolding(after, anchor), anchor, left);
      return anchor === was.id && up === was.up
        ? was
        : { ...was, id: anchor, up };
    }
  }
};

/**
 * How many levels above window `id` the highest node is that holds only
 * windows in `own`.
 */
const ownedAbove = (
  root: LayoutNode,
  id: string,
  own: readonly string[],
): number => {
  const path = pathTo(root, id);
  if (path === undefined) {
    throw new Error(`layout tree: no window ${id}`);
  } else {
    // The window itself when no container qualifies.
    const top =
      [...path.keys()].find((length) =>
        windowsIn(nodeAt(root, path.slice(0, length))).every((inside) =>
          own.includes(inside),
        ),
      ) ?? path.length;
    return path.length - top;
  }
};

/** The box the window `id` floats in. Throws for a window that is tiled. */
const floatHolding = (workspace: Workspace, id: string): Float => {
  const float = floatOn(workspace, id);
  if (float === undefined) {
    throw new Error(`workspace: window ${id} is not floating`);
  } else {
    return float;
  }
};

/** The float without the window `id`, or `undefined` when it held no other. */
const floatWithout = (float: Float, id: string): Float | undefined => {
  const { depth, root } = removed(float, id);
  return root === undefined ? undefined : { ...float, depth, root };
};

/** The window a float's own focus is on, or `undefined` for no float. */
const focusIn = (float: Float | undefined): string | undefined =>
  float === undefined ? undefined : focusedWindowIn(float.root);

/** The tiled node `ref` names. Throws if it is not tiled here. */
const tiledNodeOf = (workspace: Workspace, ref: NodeRef): LayoutNode => {
  const root = tiledRootOf(workspace, ref);
  return nodeAt(root, pathToRef(root, ref));
};

const tiledRootOf = (workspace: Workspace, ref: NodeRef): LayoutNode => {
  const { root } = workspace.tiling;
  if (root === undefined) {
    throw new Error(`workspace ${workspace.name}: nothing tiled at ${ref.id}`);
  } else {
    return root;
  }
};
