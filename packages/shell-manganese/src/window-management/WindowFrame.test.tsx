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
    // The place is the whole of what says whether the pointer went to the
    // window or the window came to the pointer — see `usePointerWarp` — so it
    // is the event's, whichever part of the window heard it.
    const crossed: (readonly [number, number])[] = [];
    render(
      <WindowFrame
        onHover={(at) => {
          crossed.push(at);
        }}
        onReach={noReach}
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
    // Every press, including one in the window already being worked in:
    // focus follows the cursor, so a press is what raises a window.
    const reached: string[] = [];
    render(
      <WindowFrame
        onHover={noHover}
        onReach={() => {
          reached.push("reach");
        }}
      >
        <button type="button">part</button>
      </WindowFrame>,
    );

    fireEvent.pointerDown(screen.getByRole("button"));

    expect(reached).toStrictEqual(["reach"]);
  });
});
