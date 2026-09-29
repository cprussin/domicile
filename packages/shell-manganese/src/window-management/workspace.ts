// One workspace: the windows tiled on it, the ones floating over them, and
// which of the two the keyboard is in.
//
// **Two layers, one focus.** sway's floating windows are not in the tree — a
// window that floats has left it — so a workspace answers two questions
// separately: which tiled window the tree has the focus in, and which floating
// window, if any, has the keyboard in front of it. `focus mode_toggle` is the
// key that swaps between the two, which is why the floating half is a field
// rather than something read off the stack.
//
// Every keyed command lands here rather than on the tree, because which of
// the two layers answers it is this file's question: `move left` retiles a
// tiled window and nudges a floating one ten pixels, and neither the tree nor
// the box knows the other exists.

import type { Axis, Direction } from "./direction";
import type { Float } from "./floating/float";
import {
  floatFor,
  floatHolds,
  grown,
  movedTo,
  retiled,
  shifted,
  sizedTo,
} from "./floating/float";
import { gapOf } from "./gaps";
import type { Rect } from "./rect";
import { droppedOn } from "./tree/drop";
import { focusMoved } from "./tree/focus-direction";
import { inserted, insertedNode } from "./tree/insert";
import { laidOut, split, splitToggled } from "./tree/layout";
import { movedBy } from "./tree/move";
import type { Layout } from "./tree/node";
import { LayoutNode as Node, NodeKind, windowsIn } from "./tree/node";
import { removed, removedAt } from "./tree/remove";
import { resized } from "./tree/resize";
import { stretched } from "./tree/stretch";
import type { Tiling } from "./tree/tiling";
import {
  focusedChild,
  focusedIdOf,
  focusedNodeOf,
  focusedParent,
  focusedWindowIn,
  focusPathOf,
  NOTHING_TILED,
  windowsOf,
  withCommandsOnWindow,
  withFocusOn,
} from "./tree/tiling";

/** A window filling the screen, and how much of the desktop it fills. */
export type Fullscreen = {
  /** Whether it covers every screen rather than the one it is on. */
  global: boolean;
  id: string;
};

export type Workspace = {
  /** The floating windows, back to front: the order is the stacking order. */
  floats: readonly Float[];
  /**
   * The floating window the keyboard is in, or `undefined` while the tiling
   * has it.
   *
   * A window of its own rather than a flag saying "the floating layer",
   * because the layer has an order and the keyboard does not follow it: the
   * pointer crossing a window behind another gives that one the keyboard and
   * leaves the stack alone.
   */
  floatFocus: string | undefined;
  /** The window filling the screen, or `undefined` when none is. */
  fullscreen: Fullscreen | undefined;
  /** What the config calls this workspace — `1` through `10`. */
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

/**
 * The window the keyboard is in, or `undefined` for an empty workspace.
 *
 * Whichever float has it, and the tiling's own focus while none does.
 */
export const focusedOn = (workspace: Workspace): string | undefined =>
  workspace.floatFocus ?? focusedIdOf(workspace.tiling);

/** The box the floating window `id` sits in, or `undefined` when it is tiled. */
export const floatOn = (workspace: Workspace, id: string): Float | undefined =>
  workspace.floats.find((float) => floatHolds(float, id));

/**
 * A window opening on the workspace, focused: into the floating group the
 * keyboard is in, if it is in one, and tiled beside the focus otherwise —
 * which is also where it goes over a lone floating window, as in sway.
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
export const tiledIn = (workspace: Workspace, id: string): Workspace => ({
  ...workspace,
  floatFocus: undefined,
  floats: onWindows(workspace.floats),
  tiling: inserted(workspace.tiling, id),
});

/**
 * The workspace without the window `id`, wherever it was.
 *
 * A fullscreen window taking its fullscreen with it, and a floating layer
 * that has run out handing the keyboard back to the tiling — which is where
 * the focus has to go, because a workspace whose focus is a window that is
 * gone is a desktop with nowhere to type.
 */
export const closed = (workspace: Workspace, id: string): Workspace => {
  const from = floatOn(workspace, id);
  const left = from === undefined ? undefined : floatWithout(from, id);
  const floats = workspace.floats
    .map((float) => (float === from ? left : float))
    .filter((float) => float !== undefined);
  return {
    ...workspace,
    // What is left of its own group, or else the float in front, because
    // closing the window the user was in puts them on the one it was
    // covering; the tiling is what is left when none is out.
    floatFocus:
      workspace.floatFocus === id
        ? focusIn(left ?? floats.at(-1))
        : workspace.floatFocus,
    floats,
    fullscreen:
      workspace.fullscreen?.id === id ? undefined : workspace.fullscreen,
    tiling: removed(workspace.tiling, id),
  };
};

/**
 * The user reached for the window `id` — a click, its tab, or the pointer
 * crossing into it.
 *
 * A floating window comes to the front as well as taking the keyboard.
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
 * `floating toggle`: what the commands are pointed at leaves the tiling — the
 * window being worked in, or the container `focus parent` selected — or the
 * float the keyboard is in rejoins it, whole.
 */
export const floatToggled = (workspace: Workspace): Workspace => {
  const { floatFocus, tiling } = workspace;
  if (floatFocus !== undefined) {
    const float = floatHolding(workspace, floatFocus);
    return {
      ...workspace,
      floatFocus: undefined,
      floats: workspace.floats.filter((found) => found !== float),
      tiling: insertedNode(tiling, float.root),
    };
  } else if (tiling.root === undefined) {
    return workspace;
  } else {
    const node = focusedNodeOf(tiling);
    return {
      ...workspace,
      floatFocus: focusedWindowIn(node),
      floats: [...workspace.floats, floatFor(node, workspace.floats.length)],
      // Not through {@link floatFocused}: this is the node leaving the tree
      // rather than the keyboard leaving it, and taking it out is already
      // what puts the commands back on a window — `removedAt` ends on
      // whatever chain is left.
      tiling: removedAt(tiling.root, focusPathOf(tiling.root, tiling.depth)),
    };
  }
};

/** A window up from the scratchpad: floating over the workspace, in front. */
export const shown = (workspace: Workspace, id: string): Workspace => ({
  ...floatFocused(workspace, id),
  floats: [
    ...workspace.floats,
    floatFor(Node.Window(id), workspace.floats.length, true),
  ],
});

/** `focus mode_toggle`: the keyboard swaps between the two layers. */
export const modeToggled = (workspace: Workspace): Workspace => {
  if (workspace.floatFocus === undefined) {
    // Into the float in front, which is the one the user last raised.
    const front = focusIn(workspace.floats.at(-1));
    return front === undefined ? workspace : floatFocused(workspace, front);
  } else {
    // And back into the tiling, if there is anything tiled to go back to.
    return focusedIdOf(workspace.tiling) === undefined
      ? workspace
      : {
          ...workspace,
          floatFocus: undefined,
          floats: onWindows(workspace.floats),
        };
  }
};

/** `focus <direction>`: through the tiling, or through a floating group. */
export const focusStepped = (
  workspace: Workspace,
  direction: Direction,
): Workspace => inLayer(workspace, (tiling) => focusMoved(tiling, direction));

/**
 * `focus parent` and `focus child`, in the tiling or in a floating group. A
 * lone floating window has no container around it, so there they do nothing.
 */
export const parentFocused = (workspace: Workspace): Workspace =>
  inLayer(workspace, focusedParent);

export const childFocused = (workspace: Workspace): Workspace =>
  inLayer(workspace, focusedChild);

/** `move <direction>`: through the tree, or ten pixels across the desktop. */
export const windowMoved = (
  workspace: Workspace,
  direction: Direction,
): Workspace =>
  reshaped(
    workspace,
    (float) => shifted(float, direction),
    (tiling) => movedBy(tiling, direction),
  );

/** `resize`: a share of the container, or ten pixels of the box. */
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

/** `fullscreen` / `fullscreen toggle global` on the window being worked in. */
export const fullscreenToggled = (
  workspace: Workspace,
  global: boolean,
): Workspace => {
  const id = focusedOn(workspace);
  const was = workspace.fullscreen;
  if (id === undefined) {
    return workspace;
  } else if (was?.id === id && was.global === global) {
    return { ...workspace, fullscreen: undefined };
  } else {
    return { ...workspace, fullscreen: { global, id } };
  }
};

/** A floating window dragged to a new corner of the desktop. */
export const floatMoved = (
  workspace: Workspace,
  id: string,
  x: number,
  y: number,
): Workspace => withFloat(workspace, id, (float) => movedTo(float, x, y));

/** A floating window dragged by a corner to a new box. */
export const floatSized = (
  workspace: Workspace,
  id: string,
  { height, width, x, y }: Rect,
): Workspace =>
  withFloat(workspace, id, (float) =>
    sizedTo(movedTo(float, x, y), width, height),
  );

/**
 * A tiled window dragged onto another and let go: onto its `edge`, or its
 * middle where that is `undefined` — see `tree/drop.ts`.
 */
export const tiledDropped = (
  workspace: Workspace,
  id: string,
  target: string,
  edge: Direction | undefined,
): Workspace => ({
  ...workspace,
  floatFocus: undefined,
  tiling: droppedOn(workspace.tiling, id, target, edge),
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
    area,
    gapOf(workspace.tiling),
  ),
});

// A floating window taking the keyboard, which is the keyboard out of the
// tree: whatever `focus parent` had selected in there goes with it, so coming
// back lands on the window the tiling was in rather than on a container the
// user chose before they left it — and so does any other float's. In a
// floating group, the group's own focus follows it, so a tabbed one shows the
// window reached; unless it is already there, which is the pointer resting in
// the window being worked in and must not undo a `focus parent`.
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
 * A tiled window taking the keyboard, which is the tree's own focus and also
 * the end of whatever the floating layer was doing in front of it.
 *
 * **A tiled window that already has it takes nothing**, and the workspace
 * comes back as the object it was. Only a tiled one: a float is raised as
 * well as focused, and a raise is a new order of the stack.
 *
 * Re-pointing the focus at the window it is already on moves no keyboard,
 * but it does run the chain back down to that window — which is `focus
 * parent` undone by a press that focused nothing, and there are plenty of
 * those: a click in the window being worked in is reported like any other,
 * the compositor answers a `focusApp` by saying where the keyboard went,
 * and a window reconfigured by the move the user just made asks for it
 * again.
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

// Whichever layer the keyboard is in answers a keyed command: the box while a
// float is being worked in as a whole — a lone window, or a group `focus
// parent` selected — and the tree it is in otherwise.
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

// A tree command on the layer the keyboard is in: the tiling, or the tree of
// the float being worked in — whose focus the keyboard follows, since a
// command like `focus left` moves it.
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

// Every float with its commands back on its window: the keyboard has left them,
// so a group one of them selected is not what the next key acts on.
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
