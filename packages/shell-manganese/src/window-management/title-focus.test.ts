import { describe, expect, it } from "bun:test";

import { titleFocus } from "./title-focus";

describe("titleFocus", () => {
  it("marks the bar of the window the keyboard is in", () => {
    expect(titleFocus({ hasKeyboard: true, shownByContainer: false })).toBe(
      "focused",
    );
  });

  it("marks a tab its container is showing more quietly", () => {
    // sway's `focused_inactive`: the tab that is open, in a container the
    // keyboard is not in. Without a state of its own it would be drawn like
    // the focused window, and two windows would claim the keyboard at once.
    expect(titleFocus({ hasKeyboard: false, shownByContainer: true })).toBe(
      "selected",
    );
  });

  it("leaves every other bar resting", () => {
    expect(titleFocus({ hasKeyboard: false, shownByContainer: false })).toBe(
      "resting",
    );
  });

  it("reads the keyboard first when a container shows that window too", () => {
    expect(titleFocus({ hasKeyboard: true, shownByContainer: true })).toBe(
      "focused",
    );
  });
});
