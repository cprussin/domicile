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
import { floatFor, grown, movedTo, shifted, sizedTo } from "./floating/float";
import { focusMoved } from "./tree/focus-direction";
import { inserted } from "./tree/insert";
import { laidOut, split, splitToggled } from "./tree/layout";
import { movedBy } from "./tree/move";
import type { Layout } from "./tree/node";
import { removed } from "./tree/remove";
import { resized } from "./tree/resize";
import type { Tiling } from "./tree/tiling";
import {
  focusedChild,
  focusedIdOf,
  focusedParent,
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
  ...workspace.floats.map(({ id }) => id),
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
  workspace.floats.find((float) => float.id === id);

/** A window opening on the workspace: tiled beside the focus, and focused. */
export const opened = (workspace: Workspace, id: string): Workspace => ({
  ...workspace,
  floatFocus: undefined,
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
  const floats = workspace.floats.filter((float) => float.id !== id);
  return {
    ...workspace,
    // The float in front, because closing the window the user was in puts
    // them on the one it was covering; the tiling is what is left when none
    // is out.
    floatFocus:
      workspace.floatFocus === id ? floats.at(-1)?.id : workspace.floatFocus,
    floats,
    fullscreen:
      workspace.fullscreen?.id === id ? undefined : workspace.fullscreen,
    tiling: removed(workspace.tiling, id),
  };
};

/**
 * The user reached for the window `id` — a click, or its tab.
 *
 * A floating window comes to the front as well as taking the keyboard, which
 * is the difference between this and {@link pointedAt}: a click raises and the
 * pointer crossing a window does not.
 */
export const reached = (workspace: Workspace, id: string): Workspace => {
  const float = floatOn(workspace, id);
  return float === undefined
    ? focusedTiled(workspace, id)
    : {
        ...floatFocused(workspace, id),
        floats: [...workspace.floats.filter(({ id: at }) => at !== id), float],
      };
};

/**
 * The pointer moved into the window `id`, which is the user working in it.
 *
 * Focus follows the cursor in this shell, and it does not raise: a window that
 * came to the front for being crossed would cover the one the user was
 * heading for.
 */
export const pointedAt = (workspace: Workspace, id: string): Workspace =>
  floatOn(workspace, id) === undefined
    ? focusedTiled(workspace, id)
    : floatFocused(workspace, id);

/** `floating toggle`: the window being worked in leaves the tiling, or rejoins it. */
export const floatToggled = (workspace: Workspace): Workspace => {
  const floating = workspace.floatFocus;
  const id = focusedOn(workspace);
  if (id === undefined) {
    return workspace;
  } else if (floating === undefined) {
    return {
      ...workspace,
      floatFocus: id,
      floats: [...workspace.floats, floatFor(id, workspace.floats.length)],
      // Not through {@link floatFocused}: this is the window leaving the tree
      // rather than the keyboard leaving it, and taking it out is already
      // what puts the commands back on a window — `removed` ends on whatever
      // chain is left.
      tiling: removed(workspace.tiling, id),
    };
  } else {
    return {
      ...workspace,
      floatFocus: undefined,
      floats: workspace.floats.filter((float) => float.id !== floating),
      tiling: inserted(workspace.tiling, floating),
    };
  }
};

/** A window up from the scratchpad: floating over the workspace, in front. */
export const shown = (workspace: Workspace, id: string): Workspace => ({
  ...floatFocused(workspace, id),
  floats: [...workspace.floats, floatFor(id, workspace.floats.length, true)],
});

/** `focus mode_toggle`: the keyboard swaps between the two layers. */
export const modeToggled = (workspace: Workspace): Workspace => {
  if (workspace.floatFocus === undefined) {
    // Into the float in front, which is the one the user last raised.
    const front = workspace.floats.at(-1)?.id;
    return front === undefined ? workspace : floatFocused(workspace, front);
  } else {
    // And back into the tiling, if there is anything tiled to go back to.
    return focusedIdOf(workspace.tiling) === undefined
      ? workspace
      : { ...workspace, floatFocus: undefined };
  }
};

/** `focus <direction>`: through the tiling, or between the floats in front. */
export const focusStepped = (
  workspace: Workspace,
  direction: Direction,
): Workspace =>
  workspace.floatFocus === undefined
    ? { ...workspace, tiling: focusMoved(workspace.tiling, direction) }
    : workspace;

/**
 * `focus parent` and `focus child`, which only the tiling has.
 *
 * A floating window has left the tree, so there is no container around it to
 * point the commands at and the keys do nothing — the same answer
 * {@link focusStepped} gives, and for the same reason.
 */
export const parentFocused = (workspace: Workspace): Workspace =>
  workspace.floatFocus === undefined
    ? { ...workspace, tiling: focusedParent(workspace.tiling) }
    : workspace;

export const childFocused = (workspace: Workspace): Workspace =>
  workspace.floatFocus === undefined
    ? { ...workspace, tiling: focusedChild(workspace.tiling) }
    : workspace;

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
export const containerSplit = (
  workspace: Workspace,
  axis: Axis,
): Workspace => ({ ...workspace, tiling: split(workspace.tiling, axis) });

/** `layout tabbed` / `layout stacking` on the container around the focus. */
export const containerLaidOut = (
  workspace: Workspace,
  layout: Layout,
): Workspace => ({ ...workspace, tiling: laidOut(workspace.tiling, layout) });

/** `layout toggle split`. */
export const splitFlipped = (workspace: Workspace): Workspace => ({
  ...workspace,
  tiling: splitToggled(workspace.tiling),
});

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

/** A floating window dragged to a new size. */
export const floatSized = (
  workspace: Workspace,
  id: string,
  width: number,
  height: number,
): Workspace =>
  withFloat(workspace, id, (float) => sizedTo(float, width, height));

// A floating window taking the keyboard, which is the keyboard out of the
// tree: whatever `focus parent` had selected in there goes with it, so coming
// back lands on the window the tiling was in rather than on a container the
// user chose before they left it.
const floatFocused = (workspace: Workspace, id: string): Workspace => ({
  ...workspace,
  floatFocus: id,
  tiling: withCommandsOnWindow(workspace.tiling),
});

// A tiled window taking the keyboard, which is the tree's own focus and also
// the end of whatever the floating layer was doing in front of it.
const focusedTiled = (workspace: Workspace, id: string): Workspace => ({
  ...workspace,
  floatFocus: undefined,
  tiling: withFocusOn(workspace.tiling, id),
});

// Whichever layer the keyboard is in answers a keyed command: the box while a
// float is being worked in, and the tree otherwise.
const reshaped = (
  workspace: Workspace,
  float: (float: Float) => Float,
  tiling: (tiling: Tiling) => Tiling,
): Workspace => {
  const floating = workspace.floatFocus;
  if (floating === undefined) {
    return { ...workspace, tiling: tiling(workspace.tiling) };
  } else {
    return withFloat(workspace, floating, float);
  }
};

const withFloat = (
  workspace: Workspace,
  id: string,
  into: (float: Float) => Float,
): Workspace => {
  if (floatOn(workspace, id) === undefined) {
    throw new Error(`workspace: window ${id} is not floating`);
  } else {
    return {
      ...workspace,
      floats: workspace.floats.map((float) =>
        float.id === id ? into(float) : float,
      ),
    };
  }
};
