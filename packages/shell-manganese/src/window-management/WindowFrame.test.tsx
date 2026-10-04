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
        onHover={(at) => {
          crossed.push(at);
        }}
        onReach={noReach}
        width={undefined}
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
        onHover={noHover}
        onReach={() => {
          reached.push("reach");
        }}
        width={undefined}
      >
        <button type="button">part</button>
      </WindowFrame>,
    );

    fireEvent.pointerDown(screen.getByRole("button"));

    expect(reached).toStrictEqual(["reach"]);
  });

  it("slides its parts the width of the screen it is on", () => {
    // A workspace switch slides by the width of the window's screen.
    render(
      <WindowFrame onHover={noHover} onReach={noReach} width={1280}>
        <button type="button">part</button>
      </WindowFrame>,
    );

    expect(
      screen
        .getByRole("button")
        .parentElement?.style.getPropertyValue("--workspace-width"),
    ).toBe("1280px");
  });
});
