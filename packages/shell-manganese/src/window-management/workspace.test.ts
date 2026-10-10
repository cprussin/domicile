import { describe, expect, it } from "bun:test";

import { Axis, Direction } from "./direction";
import { FLOAT_STEP } from "./floating/float";
import { Layout, NodeKind, windowsIn } from "./tree/node";
import { focusedNodeOf, focusedWindowIn, windowsOf } from "./tree/tiling";
import type { Workspace } from "./workspace";
import {
  childFocused,
  closed,
  containerLaidOut,
  containerSplit,
  emptyWorkspace,
  enteredBy,
  floatToggled,
  focusedOn,
  focusLeaves,
  focusStepped,
  fullscreenToggled,
  holds,
  modeToggled,
  opened,
  parentFocused,
  reached,
  windowGrown,
  windowMoved,
  windowsOn,
} from "./workspace";

/** The screen a float is sized to fit. */
const SCREEN = { height: 1080, width: 1920, x: 0, y: 0 };

/** A workspace with these windows tiled on it, the last one focused. */
const tiling = (...ids: readonly string[]) =>
  ids.reduce((workspace, id) => opened(workspace, id), emptyWorkspace("1"));

describe("opened", () => {
  it("tiles the window and gives it the keyboard", () => {
    const workspace = tiling("a", "b");

    expect(windowsOn(workspace)).toEqual(["a", "b"]);
    expect(focusedOn(workspace)).toBe("b");
  });

  it("tiles a window even while a float is being worked in", () => {
    // Matches sway: a new window tiles even while a lone float has focus.
    const workspace = opened(floatToggled(tiling("a"), SCREEN), "b");

    expect(windowsOf(workspace.tiling)).toEqual(["b"]);
    expect(focusedOn(workspace)).toBe("b");
  });

  it("opens into the floating group the keyboard is in", () => {
    const workspace = opened(
      floatToggled(parentFocused(grouped()), SCREEN),
      "d",
    );

    expect(windowsOf(workspace.tiling)).toEqual(["a"]);
    expect(workspace.floats.map(({ root }) => windowsIn(root))).toEqual([
      ["b", "c", "d"],
    ]);
    expect(focusedOn(workspace)).toBe("d");
  });
});

describe("closed", () => {
  it("takes a tiled window out and leaves the focus on a survivor", () => {
    const workspace = closed(tiling("a", "b"), "b");

    expect(windowsOn(workspace)).toEqual(["a"]);
    expect(focusedOn(workspace)).toBe("a");
  });

  it("takes a floating window out and falls back to the tiling", () => {
    const workspace = closed(floatToggled(tiling("a", "b"), SCREEN), "b");

    expect(windowsOn(workspace)).toEqual(["a"]);
    expect(focusedOn(workspace)).toBe("a");
  });

  it("gives up fullscreen with the window that was in it", () => {
    const full = fullscreenToggled(tiling("a", "b"), false);

    expect(closed(full, "b").fullscreen).toBeUndefined();
  });
});

describe("floatToggled", () => {
  it("takes the window being worked in out of the tiling", () => {
    const workspace = floatToggled(tiling("a", "b"), SCREEN);

    expect(windowsOf(workspace.tiling)).toEqual(["a"]);
    expect(workspace.floats.flatMap(({ root }) => windowsIn(root))).toEqual([
      "b",
    ]);
    expect(focusedOn(workspace)).toBe("b");
  });

  it("puts it back where the tiling focus is", () => {
    const workspace = floatToggled(
      floatToggled(tiling("a", "b"), SCREEN),
      SCREEN,
    );

    expect(workspace.floats).toEqual([]);
    expect(windowsOf(workspace.tiling)).toEqual(["a", "b"]);
    expect(focusedOn(workspace)).toBe("b");
  });

  it("floats the whole container `focus parent` selected", () => {
    // `mod+a` then `mod+Shift+Tab`, as in sway: the group floats as one,
    // keeping its internal layout.
    const workspace = floatToggled(parentFocused(grouped()), SCREEN);

    expect(windowsOf(workspace.tiling)).toEqual(["a"]);
    expect(workspace.floats.map(({ root }) => root)).toEqual([
      focusedNodeOf(parentFocused(grouped()).tiling),
    ]);
    expect(focusedOn(workspace)).toBe("c");
  });

  it("puts the whole group back, still a group", () => {
    const workspace = floatToggled(
      floatToggled(parentFocused(grouped()), SCREEN),
      SCREEN,
    );

    expect(workspace.floats).toEqual([]);
    expect(windowsOf(workspace.tiling)).toEqual(["a", "b", "c"]);
    expect(focusedOn(workspace)).toBe("c");
    expect(focusedNodeOf(parentFocused(workspace).tiling)).toMatchObject({
      kind: NodeKind.Container,
      layout: Layout.SplitV,
    });
  });
});

/** What the commands are pointed at in the one float on `workspace`. */
const selectedIn = (workspace: Workspace) => {
  const [float] = workspace.floats;
  if (float === undefined) {
    throw new Error("test: nothing is floating");
  } else {
    return focusedNodeOf(float);
  }
};

/** `a` tiled beside `b` and `c`, which share a vertical split; `c` focused. */
const grouped = () =>
  opened(containerSplit(tiling("a", "b"), Axis.Vertical), "c");

describe("a floating group", () => {
  const floated = () => floatToggled(parentFocused(grouped()), SCREEN);

  it("keeps floating what is left when one of its windows closes", () => {
    const workspace = closed(floated(), "c");

    expect(workspace.floats.map(({ root }) => windowsIn(root))).toEqual([
      ["b"],
    ]);
    expect(focusedOn(workspace)).toBe("b");
  });

  it("moves the focus through the group", () => {
    expect(focusedOn(focusStepped(floated(), Direction.Up))).toBe("b");
  });

  it("selects the group with `focus parent`, and comes back down", () => {
    const selected = parentFocused(floated());

    expect(selectedIn(selected)).toMatchObject({ kind: NodeKind.Container });
    expect(selectedIn(childFocused(selected))).toMatchObject({
      id: "c",
      kind: NodeKind.Window,
    });
  });

  it("lays out the container the focus is in", () => {
    const workspace = containerLaidOut(floated(), Layout.Tabbed);

    expect(workspace.floats[0]?.root).toMatchObject({ layout: Layout.Tabbed });
  });

  it("moves a window through the group rather than the box", () => {
    const before = floated();
    const workspace = windowMoved(before, Direction.Up);

    expect(workspace.floats.flatMap(({ root }) => windowsIn(root))).toEqual([
      "c",
      "b",
    ]);
    expect(workspace.floats[0]?.x).toBe(before.floats[0]?.x);
  });

  it("moves the whole box once the group is selected", () => {
    const selected = parentFocused(floated());

    expect(windowMoved(selected, Direction.Right).floats[0]?.x).toBe(
      (selected.floats[0]?.x ?? 0) + FLOAT_STEP,
    );
  });

  it("keeps the group selected while the pointer rests in it", () => {
    // Focus follows the cursor, so the focused window is reported again
    // constantly; that must not undo `focus parent`.
    const selected = parentFocused(floated());

    expect(selectedIn(reached(selected, "c"))).toMatchObject({
      kind: NodeKind.Container,
    });
  });

  it("gives the keyboard to the window in it that is reached", () => {
    const workspace = reached(floated(), "b");

    expect(focusedOn(workspace)).toBe("b");
    expect(workspace.floats.map(({ root }) => focusedWindowIn(root))).toEqual([
      "b",
    ]);
  });
});

describe("modeToggled", () => {
  it("swaps the keyboard between the floating and tiled windows", () => {
    const workspace = floatToggled(tiling("a", "b"), SCREEN);

    expect(focusedOn(modeToggled(workspace))).toBe("a");
    expect(focusedOn(modeToggled(modeToggled(workspace)))).toBe("b");
  });

  it("has nowhere to swap to with nothing floating", () => {
    const workspace = tiling("a");

    expect(modeToggled(workspace)).toBe(workspace);
  });
});

/** Two floats over a tiled window: `b` behind, `c` in front and focused. */
const cascaded = () =>
  floatToggled(
    reached(floatToggled(tiling("a", "b", "c"), SCREEN), "b"),
    SCREEN,
  );

describe("reached", () => {
  it("changes nothing when the window being worked in is reached again", () => {
    // `AppWindow` relies on this for presses in the focused window, which is
    // most presses. Refocusing would also undo `focus parent`.
    const selected = parentFocused(tiling("a", "b"));

    expect(reached(selected, "b")).toBe(selected);
  });

  it("brings a floating window to the front", () => {
    const workspace = reached(cascaded(), "c");

    expect(workspace.floats.flatMap(({ root }) => windowsIn(root))).toEqual([
      "b",
      "c",
    ]);
    expect(focusedOn(workspace)).toBe("c");
  });

  it("makes a tiled window the one being worked in", () => {
    expect(focusedOn(reached(cascaded(), "a"))).toBe("a");
  });
});

describe("focusLeaves", () => {
  it("is off the edge of the tiling", () => {
    expect(focusLeaves(tiling("a", "b"), Direction.Right)).toBe(true);
    expect(focusLeaves(tiling("a", "b"), Direction.Left)).toBe(false);
  });

  it("is every way out of a window filling the screen", () => {
    // Matches sway: the tiling behind it is hidden.
    const full = fullscreenToggled(tiling("a", "b"), false);

    expect(focusLeaves(full, Direction.Left)).toBe(true);
  });

  it("is no way out of a window filling every screen", () => {
    // Matches sway: there is no other screen to move to.
    const global = fullscreenToggled(tiling("a", "b"), true);

    expect(focusLeaves(global, Direction.Right)).toBe(false);
  });

  it("is never from a floating window", () => {
    // Matches sway: `focus <direction>` stays among the workspace's floats.
    expect(
      focusLeaves(floatToggled(tiling("a"), SCREEN), Direction.Right),
    ).toBe(false);
  });
});

describe("enteredBy", () => {
  it("puts the keyboard on the near edge of the tiling", () => {
    const split = containerLaidOut(tiling("a", "b"), Layout.SplitH);

    expect(focusedOn(enteredBy(split, Direction.Right))).toBe("a");
  });

  it("puts the commands back on a window", () => {
    // Matches sway: returning focus lands on a window, not an earlier
    // `focus parent` selection.
    const selected = parentFocused(
      containerLaidOut(tiling("a", "b"), Layout.SplitH),
    );

    const entered = enteredBy(selected, Direction.Left);

    expect(focusedOn(entered)).toBe("b");
    expect(focusedNodeOf(entered.tiling).kind).toBe(NodeKind.Window);
  });

  it("leaves it on a window filling the screen", () => {
    const full = fullscreenToggled(tiling("a", "b"), false);

    expect(enteredBy(full, Direction.Right)).toBe(full);
  });

  it("leaves an empty workspace as it is", () => {
    const empty = emptyWorkspace("1");

    expect(enteredBy(empty, Direction.Right)).toBe(empty);
  });
});

describe("the keyed commands", () => {
  it("moves the focus through the tiling", () => {
    expect(focusedOn(focusStepped(tiling("a", "b"), Direction.Left))).toBe("a");
  });

  it("moves a tiled window through the tree", () => {
    const workspace = windowMoved(tiling("a", "b"), Direction.Left);

    expect(windowsOf(workspace.tiling)).toEqual(["b", "a"]);
  });

  it("shifts a floating window by a step instead of retiling it", () => {
    const floated = floatToggled(tiling("a", "b"), SCREEN);

    expect(windowMoved(floated, Direction.Right).floats[0]?.x).toBe(
      (floated.floats[0]?.x ?? 0) + FLOAT_STEP,
    );
  });

  it("resizes whichever window is being worked in", () => {
    const floated = floatToggled(tiling("a", "b"), SCREEN);

    expect(windowGrown(floated, Direction.Right).floats[0]?.width).toBe(
      (floated.floats[0]?.width ?? 0) + FLOAT_STEP,
    );
    expect(
      windowGrown(tiling("a", "b"), Direction.Right).tiling.root,
    ).toMatchObject({ fractions: [0.48, 0.52] });
  });

  it("rearranges the container the focus is in", () => {
    expect(
      containerLaidOut(tiling("a", "b"), Layout.Tabbed).tiling.root,
    ).toMatchObject({ layout: Layout.Tabbed });
  });

  it("leaves the tiling alone while a float has the keyboard", () => {
    // `focus parent` acts on the focused layer, and a float has no parent
    // container.
    const floating = floatToggled(tiling("a", "b", "c"), SCREEN);

    expect(parentFocused(floating).tiling).toBe(floating.tiling);
  });

  it("takes the commands out of the tiling with the keyboard", () => {
    // Matches sway's `mode_toggle`: returning to the tiling lands on a
    // window, not on the container selected before leaving.
    const floated = floatToggled(tiling("a", "b", "c"), SCREEN);
    const selected = parentFocused(modeToggled(floated));

    const away = modeToggled(selected);

    expect(focusedNodeOf(away.tiling)).toMatchObject({ kind: NodeKind.Window });
  });

  it("takes them out of it when the pointer crosses a float, too", () => {
    // Focus follows the cursor, so this is the usual way to leave the tiling.
    const floated = floatToggled(tiling("a", "b", "c"), SCREEN);
    const selected = parentFocused(modeToggled(floated));

    const crossed = reached(selected, "c");

    expect(focusedNodeOf(crossed.tiling)).toMatchObject({
      kind: NodeKind.Window,
    });
  });

  it("splits the focused window's own box", () => {
    expect(
      containerSplit(tiling("a"), Axis.Vertical).tiling.root,
    ).toMatchObject({ layout: Layout.SplitV });
  });
});

describe("fullscreenToggled", () => {
  it("fills the screen with the window being worked in, and stops", () => {
    const full = fullscreenToggled(tiling("a", "b"), false);

    expect(full.fullscreen).toEqual({ global: false, id: "b" });
    expect(fullscreenToggled(full, false).fullscreen).toBeUndefined();
  });

  it("fills every screen when asked globally", () => {
    expect(fullscreenToggled(tiling("a"), true).fullscreen).toEqual({
      global: true,
      id: "a",
    });
  });

  it("moves fullscreen to whichever window asks for it", () => {
    const full = fullscreenToggled(tiling("a", "b"), false);

    expect(fullscreenToggled(reached(full, "a"), false).fullscreen).toEqual({
      global: false,
      id: "a",
    });
  });
});

describe("holds", () => {
  it("knows its own windows, tiled or floating", () => {
    const workspace = floatToggled(tiling("a", "b"), SCREEN);

    expect(holds(workspace, "a")).toBe(true);
    expect(holds(workspace, "b")).toBe(true);
    expect(holds(workspace, "z")).toBe(false);
  });
});
