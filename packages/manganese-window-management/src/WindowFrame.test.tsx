import { afterEach, describe, expect, it } from "bun:test";
import { Button } from "@domicile-desktop/component-library/Button";
import { Popover } from "@domicile-desktop/component-library/Popover";
import {
  drawAt,
  drawPopups,
  popupLeft,
  undrawPopups,
} from "@domicile-desktop/test-support/popup-layout";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WindowFrame } from "./WindowFrame";
import type { WindowMotion } from "./window-motion";

const noHover = () => {
  // Nothing in the case moves the pointer into the window.
};

const noReach = () => {
  // Nothing in the case presses the window.
};

describe("WindowFrame", () => {
  afterEach(undrawPopups);

  it("keeps popups opened in the window inside its frame", async () => {
    render(
      <WindowFrame
        frame={{ height: 800, width: 400, x: 0, y: 0 }}
        motion="resting"
        onHover={noHover}
        onReach={noReach}
        rewound={0}
        screen={undefined}
      >
        <Popover trigger={<Button>Site settings</Button>}>Body</Popover>
      </WindowFrame>,
    );
    const trigger = screen.getByRole("button", { name: "Site settings" });
    drawAt(trigger, { height: 28, width: 28, x: 360, y: 40 });
    drawPopups("dialog", { height: 100, width: 300 });

    await userEvent.click(trigger);

    await waitFor(() => {
      expect(popupLeft("dialog") + 300).toBeLessThanOrEqual(400);
    });
  });

  it("reports where the pointer crossed into any part of the window", () => {
    // `usePointerWarp` needs the position to tell a pointer move from a
    // window appearing under the pointer.
    const crossed: (readonly [number, number])[] = [];
    render(
      <WindowFrame
        frame={undefined}
        motion="resting"
        onHover={(at) => {
          crossed.push(at);
        }}
        onReach={noReach}
        rewound={0}
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
        motion="resting"
        onHover={noHover}
        onReach={() => {
          reached.push("reach");
        }}
        rewound={0}
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
    const styleOf = (motion: WindowMotion = "resting") => {
      render(
        <WindowFrame
          frame={{ height: 400, width: 600, x: 40, y: 300 }}
          motion={motion}
          onHover={noHover}
          onReach={noReach}
          rewound={0}
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

    it("lifts its parts far enough to clear the top of the screen while the scratchpad slides it", () => {
      // The scratchpad slides a window up off the screen and back down.
      expect(styleOf("dropping")?.getPropertyValue("--lift")).toBe("600px");
    });
  });
});
