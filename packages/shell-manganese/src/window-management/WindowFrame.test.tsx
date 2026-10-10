import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

import { WindowFrame } from "./WindowFrame";

const noHover = () => {
  // Nothing in the case moves the pointer into the window.
};

const noReach = () => {
  // Nothing in the case presses the window.
};

describe("WindowFrame", () => {
  it("reports where the pointer crossed into any part of the window", () => {
    // `usePointerWarp` needs the position to tell a pointer move from a
    // window appearing under the pointer.
    const crossed: (readonly [number, number])[] = [];
    render(
      <WindowFrame
        frame={undefined}
        onHover={(at) => {
          crossed.push(at);
        }}
        onReach={noReach}
        screen={undefined}
      >
        <button type="button">part</button>
      </WindowFrame>,
    );

    fireEvent.pointerOver(screen.getByRole("button"), {
      clientX: 640,
      clientY: 400,
    });

    expect(crossed).toStrictEqual([[640, 400]]);
  });

  it("reports a press on any part of the window", () => {
    // Even in the active window: focus follows the cursor, but only a press
    // raises a window.
    const reached: string[] = [];
    render(
      <WindowFrame
        frame={undefined}
        onHover={noHover}
        onReach={() => {
          reached.push("reach");
        }}
        screen={undefined}
      >
        <button type="button">part</button>
      </WindowFrame>,
    );

    fireEvent.pointerDown(screen.getByRole("button"));

    expect(reached).toStrictEqual(["reach"]);
  });

  describe("on a screen", () => {
    const SCREEN = { height: 800, width: 1280, x: 0, y: 100 };
    const styleOf = () => {
      render(
        <WindowFrame
          frame={{ height: 400, width: 600, x: 40, y: 300 }}
          onHover={noHover}
          onReach={noReach}
          screen={SCREEN}
        >
          <button type="button">part</button>
        </WindowFrame>,
      );
      return screen.getByRole("button").parentElement?.style;
    };

    it("slides its parts the width of the screen", () => {
      // A workspace switch slides by the width of the window's screen.
      expect(styleOf()?.getPropertyValue("--workspace-width")).toBe("1280px");
    });

    it("bounds its parts' slides by the screen", () => {
      // A workspace switch clips each part to its screen.
      const style = styleOf();

      expect([
        style?.getPropertyValue("--screen-x"),
        style?.getPropertyValue("--screen-y"),
        style?.getPropertyValue("--screen-height"),
      ]).toStrictEqual(["0px", "100px", "800px"]);
    });

    it("lifts its parts far enough to clear the top of the screen", () => {
      // The scratchpad slides a window up off the screen and back down.
      expect(styleOf()?.getPropertyValue("--lift")).toBe("600px");
    });
  });
});
