import { describe, expect, it } from "bun:test";

import { titleFocus } from "./title-focus";

describe("titleFocus", () => {
  it("marks the bar of the window the keyboard is in", () => {
    expect(
      titleFocus({
        hasKeyboard: true,
        inSelection: false,
        isTab: false,
        shownByContainer: false,
      }),
    ).toBe("focused");
  });

  it("marks a tab its container is showing more quietly", () => {
    // sway's `focused_inactive`: the open tab of an unfocused container.
    expect(
      titleFocus({
        hasKeyboard: false,
        inSelection: false,
        isTab: false,
        shownByContainer: true,
      }),
    ).toBe("selected");
  });

  it("leaves every other bar resting", () => {
    expect(
      titleFocus({
        hasKeyboard: false,
        inSelection: false,
        isTab: false,
        shownByContainer: false,
      }),
    ).toBe("resting");
  });

  it("reads the keyboard first when a container shows that window too", () => {
    expect(
      titleFocus({
        hasKeyboard: true,
        inSelection: false,
        isTab: false,
        shownByContainer: true,
      }),
    ).toBe("focused");
  });

  it("raises every bar of the group `focus parent` selected", () => {
    expect(
      titleFocus({
        hasKeyboard: false,
        inSelection: true,
        isTab: false,
        shownByContainer: false,
      }),
    ).toBe("selected");
  });

  it("sets the keyboard's own bar apart inside that group", () => {
    // Every bar in the group is raised, so the focused one needs its own
    // state.
    expect(
      titleFocus({
        hasKeyboard: true,
        inSelection: true,
        isTab: false,
        shownByContainer: false,
      }),
    ).toBe("leaf");
  });

  it("leaves a tab in a selected group to say where the keyboard is", () => {
    // Its tab strip shows the selection instead. See `TitleBar`.
    expect(
      titleFocus({
        hasKeyboard: true,
        inSelection: true,
        isTab: true,
        shownByContainer: true,
      }),
    ).toBe("focused");
    expect(
      titleFocus({
        hasKeyboard: false,
        inSelection: true,
        isTab: true,
        shownByContainer: false,
      }),
    ).toBe("resting");
  });
});
