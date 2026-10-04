import { describe, expect, it } from "bun:test";

import { titleFocus } from "./title-focus";

describe("titleFocus", () => {
  it("marks the bar of the window the keyboard is in", () => {
    expect(
      titleFocus({
        hasKeyboard: true,
        inSelection: false,
        shownByContainer: false,
      }),
    ).toBe("focused");
  });

  it("marks a tab its container is showing more quietly", () => {
    // sway's `focused_inactive`: the tab that is open, in a container the
    // keyboard is not in. Without a state of its own it would be drawn like
    // the focused window, and two windows would claim the keyboard at once.
    expect(
      titleFocus({
        hasKeyboard: false,
        inSelection: false,
        shownByContainer: true,
      }),
    ).toBe("selected");
  });

  it("leaves every other bar resting", () => {
    expect(
      titleFocus({
        hasKeyboard: false,
        inSelection: false,
        shownByContainer: false,
      }),
    ).toBe("resting");
  });

  it("reads the keyboard first when a container shows that window too", () => {
    expect(
      titleFocus({
        hasKeyboard: true,
        inSelection: false,
        shownByContainer: true,
      }),
    ).toBe("focused");
  });

  it("raises every bar of the group `focus parent` selected", () => {
    expect(
      titleFocus({
        hasKeyboard: false,
        inSelection: true,
        shownByContainer: false,
      }),
    ).toBe("selected");
  });

  it("sets the keyboard's own bar apart inside that group", () => {
    // Every bar of the group is raised, so the one the keyboard is in needs
    // more than the raise to stand apart from them.
    expect(
      titleFocus({
        hasKeyboard: true,
        inSelection: true,
        shownByContainer: false,
      }),
    ).toBe("leaf");
  });
});
