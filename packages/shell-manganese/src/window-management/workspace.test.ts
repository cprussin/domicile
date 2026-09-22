import { describe, expect, it } from "bun:test";

import { Axis, Direction } from "./direction";
import { FLOAT_STEP } from "./floating/float";
import { Layout, NodeKind } from "./tree/node";
import { focusedNodeOf, windowsOf } from "./tree/tiling";
import {
  closed,
  containerLaidOut,
  containerSplit,
  emptyWorkspace,
  floatToggled,
  focusedOn,
  focusStepped,
  fullscreenToggled,
  holds,
  modeToggled,
  opened,
  parentFocused,
  pointedAt,
  reached,
  windowGrown,
  windowMoved,
  windowsOn,
} from "./workspace";

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
    // sway opens a new window into the tiling whatever is floating over it.
    const workspace = opened(floatToggled(tiling("a")), "b");

    expect(windowsOf(workspace.tiling)).toEqual(["b"]);
    expect(focusedOn(workspace)).toBe("b");
  });
});

describe("closed", () => {
  it("takes a tiled window out and leaves the focus on a survivor", () => {
    const workspace = closed(tiling("a", "b"), "b");

    expect(windowsOn(workspace)).toEqual(["a"]);
    expect(focusedOn(workspace)).toBe("a");
  });

  it("takes a floating window out and falls back to the tiling", () => {
    const workspace = closed(floatToggled(tiling("a", "b")), "b");

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
    const workspace = floatToggled(tiling("a", "b"));

    expect(windowsOf(workspace.tiling)).toEqual(["a"]);
    expect(workspace.floats.map(({ id }) => id)).toEqual(["b"]);
    expect(focusedOn(workspace)).toBe("b");
  });

  it("puts it back where the tiling focus is", () => {
    const workspace = floatToggled(floatToggled(tiling("a", "b")));

    expect(workspace.floats).toEqual([]);
    expect(windowsOf(workspace.tiling)).toEqual(["a", "b"]);
    expect(focusedOn(workspace)).toBe("b");
  });
});

describe("modeToggled", () => {
  it("swaps the keyboard between the floating and tiled windows", () => {
    const workspace = floatToggled(tiling("a", "b"));

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
  floatToggled(reached(floatToggled(tiling("a", "b", "c")), "b"));

describe("reached", () => {
  it("changes nothing when the window being worked in is reached again", () => {
    // "A reach that moves nothing returns the state it was given", which is
    // what `AppWindow` leans on for the press it reports in the window the
    // user is already in — focus follows the cursor, so that is most presses.
    // Re-pointing the focus at the window it is already on used to be
    // invisible; it is not, now that the depth along the chain is what
    // `focus parent` selected with.
    const selected = parentFocused(tiling("a", "b"));

    expect(reached(selected, "b")).toBe(selected);
  });

  it("brings a floating window to the front", () => {
    const workspace = reached(cascaded(), "c");

    expect(workspace.floats.map(({ id }) => id)).toEqual(["b", "c"]);
    expect(focusedOn(workspace)).toBe("c");
  });

  it("makes a tiled window the one being worked in", () => {
    expect(focusedOn(reached(cascaded(), "a"))).toBe("a");
  });
});

describe("pointedAt", () => {
  it("gives a floating window the keyboard without raising it", () => {
    const workspace = pointedAt(cascaded(), "c");

    expect(workspace.floats.map(({ id }) => id)).toEqual(["c", "b"]);
    expect(focusedOn(workspace)).toBe("c");
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
    const floated = floatToggled(tiling("a", "b"));

    expect(windowMoved(floated, Direction.Right).floats[0]?.x).toBe(
      (floated.floats[0]?.x ?? 0) + FLOAT_STEP,
    );
  });

  it("resizes whichever window is being worked in", () => {
    const floated = floatToggled(tiling("a", "b"));

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
    // `focus parent` acts on the layer the keyboard is in, the way every
    // other keyed command does, and a floating window has left the tree —
    // so there is no container around it to select. A tiling that selected
    // one anyway would draw a line round a group nothing is pointed at.
    const floating = floatToggled(tiling("a", "b", "c"));

    expect(parentFocused(floating)).toBe(floating);
  });

  it("takes the commands out of the tiling with the keyboard", () => {
    // A selection is what the keys are pointed at, and the keyboard going to
    // a float takes them out of the tree with it — so coming back lands on
    // the window the tiling was in rather than on a container chosen before
    // the user left it, which is what sway's `mode_toggle` does.
    const floated = floatToggled(tiling("a", "b", "c"));
    const selected = parentFocused(modeToggled(floated));

    const away = modeToggled(selected);

    expect(focusedNodeOf(away.tiling)).toMatchObject({ kind: NodeKind.Window });
  });

  it("takes them out of it when the pointer crosses a float, too", () => {
    // Focus follows the cursor here, so this is the everyday way out of the
    // tiling rather than `mod+Tab`: the pointer reaching a floating window
    // is the keyboard leaving the tree, and the selection goes with it.
    const floated = floatToggled(tiling("a", "b", "c"));
    const selected = parentFocused(modeToggled(floated));

    const crossed = pointedAt(selected, "c");

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
    const workspace = floatToggled(tiling("a", "b"));

    expect(holds(workspace, "a")).toBe(true);
    expect(holds(workspace, "b")).toBe(true);
    expect(holds(workspace, "z")).toBe(false);
  });
});
