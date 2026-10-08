import { describe, expect, it } from "bun:test";

import type { Placement } from "./placement";
import type { Shown } from "./shown";
import { ShellWindow } from "./window";
import { switchedTo, towardsOf } from "./workspace-switch";

const TERMINAL = ShellWindow.App("term", "kitty");

const placementOf = (id: string): Placement => ({
  bar: { height: 30, width: 1200, x: 0, y: 32 },
  behind: undefined,
  depth: 0,
  frame: { height: 800, width: 1200, x: 0, y: 32 },
  id,
  openTab: undefined,
  selected: false,
  soleTab: false,
  surface: { height: 770, width: 1200, x: 0, y: 62 },
  tabbed: undefined,
});

const on = (current: string, showing: readonly ShellWindow[]): Shown => ({
  activeId: showing[0]?.id,
  current,
  placements: showing.map(({ id }) => placementOf(id)),
  tabs: [],
  windows: [TERMINAL],
});

describe("towardsOf", () => {
  it("moves towards the end when the workspace switched to is a later one", () => {
    expect(towardsOf("1", "2")).toBe("end");
  });

  it("and towards the start when it is an earlier one", () => {
    expect(towardsOf("3", "2")).toBe("start");
  });

  // `10` is the last workspace, but `"10" < "9"`.
  it("orders them the way the desktop does, not the way a string sorts", () => {
    expect(towardsOf("9", "10")).toBe("end");
  });

  it("throws for a workspace the desktop does not have", () => {
    expect(() => towardsOf("1", "scratch")).toThrow("scratch");
  });
});

describe("switchedTo", () => {
  it("keeps the workspace that has gone, with what was on it", () => {
    const left = switchedTo(on("1", [TERMINAL]), on("2", []));

    expect(left).toStrictEqual({
      activeId: TERMINAL.id,
      placements: [placementOf(TERMINAL.id)],
      tabs: [],
      towards: "end",
    });
  });

  it("says nothing when the workspace on screen has not changed", () => {
    expect(
      switchedTo(on("1", [TERMINAL]), on("1", [TERMINAL])),
    ).toBeUndefined();
  });

  // A switch ends when an animation on screen ends, and two empty workspaces
  // have nothing to animate.
  it("says nothing when neither workspace has anything on it", () => {
    expect(switchedTo(on("1", []), on("2", []))).toBeUndefined();
  });

  it("still counts a switch onto an empty workspace", () => {
    expect(switchedTo(on("1", [TERMINAL]), on("2", []))).toBeDefined();
  });

  it("and a switch from one", () => {
    expect(switchedTo(on("1", []), on("2", [TERMINAL]))).toBeDefined();
  });
});
