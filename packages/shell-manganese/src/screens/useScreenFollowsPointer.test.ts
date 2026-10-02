import { afterEach, describe, expect, it } from "bun:test";
import type { Display } from "@domicile/component-library/display-source";
import { fireEvent, renderHook } from "@testing-library/react";
import { WINDOW_FRAME } from "../window-management/WindowFrame";
import { WindowAction } from "../window-management/window-state";
import { useScreenFollowsPointer } from "./useScreenFollowsPointer";

const LEFT: Display = {
  name: "left",
  position: [0, 0],
  scale: 1,
  size: [1920, 1080],
};
const RIGHT: Display = { ...LEFT, name: "right", position: [1920, 0] };

/** The keyboard on the left screen, and every action the hook took. */
const followingFromLeft = () => {
  const acted: WindowAction[] = [];
  renderHook(() => {
    useScreenFollowsPointer({
      act: (action) => acted.push(action),
      displays: [LEFT, RIGHT],
      focused: "left",
    });
  });
  return acted;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("useScreenFollowsPointer", () => {
  it("takes the keyboard to a screen the pointer moves onto", () => {
    const acted = followingFromLeft();

    fireEvent.pointerMove(document.body, { clientX: 2000, clientY: 500 });

    expect(acted).toEqual([WindowAction.ScreenHovered("right")]);
  });

  it("leaves the keyboard alone over a window that spills onto that screen", () => {
    const acted = followingFromLeft();
    const frame = document.createElement("div");
    frame.setAttribute(WINDOW_FRAME, "");
    const app = document.createElement("span");
    frame.append(app);
    document.body.append(frame);

    fireEvent.pointerMove(app, { clientX: 2000, clientY: 500 });

    expect(acted).toEqual([]);
  });
});
