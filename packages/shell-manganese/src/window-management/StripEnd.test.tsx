import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";

import { StripEnd } from "./StripEnd";
import { Aim } from "./tiled/aim";
import { Layout, LayoutNode } from "./tree/node";

/** The empty end of a strip over "a" and "b", which a third of it shows. */
const END = { height: 30, width: 400, x: 200, y: 0 };
const GROUP_FRAME = { height: 400, width: 600, x: 0, y: 0 };

/** A tiled window beside the group, to drop it on. */
const OTHER = { frame: { height: 400, width: 600, x: 600, y: 0 }, id: "c" };

const MIDDLE_BUTTON = 1;

/** The group floating, at (100, 100). */
const FLOAT = {
  depth: 1,
  height: 400,
  root: LayoutNode.Container(Layout.Tabbed, [
    LayoutNode.Window("a"),
    LayoutNode.Window("b"),
  ]),
  scratchpad: false,
  width: 600,
  x: 100,
  y: 100,
};

const nothing = () => undefined;

const endProps = {
  depth: 0,
  float: undefined,
  fullscreen: false,
  group: { node: { id: "a", up: 1 }, windows: ["a", "b"] },
  onAim: nothing,
  onDrop: nothing,
  onDropOn: nothing,
  onFloat: nothing,
  onFullscreen: nothing,
  onGrab: nothing,
  onMove: nothing,
  rect: END,
  targets: {
    screens: [],
    tabs: [],
    windows: [{ frame: GROUP_FRAME, id: "a" }, OTHER],
  },
} as const;

const endOf = (container: HTMLElement): Element => {
  const element = container.firstElementChild;
  if (element === null) {
    throw new Error("test: the strip end rendered no element");
  } else {
    return element;
  }
};

/** Presses the end, moves to `x`, `y` and lets go. */
const dragTo = (container: HTMLElement, x: number, y: number): void => {
  fireEvent.pointerDown(endOf(container), {
    button: 0,
    clientX: 300,
    clientY: 10,
    pointerId: 1,
  });
  fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });
};

describe("StripEnd", () => {
  describe("a tiled group", () => {
    it("is dropped where it is aimed", () => {
      const onDropOn = mock((_aim: Aim) => undefined);
      const { container } = render(
        <StripEnd {...endProps} onDropOn={onDropOn} />,
      );
      dragTo(container, 900, 200);
      expect(onDropOn).toHaveBeenCalledWith(
        Aim.Window(OTHER.id, undefined, OTHER.frame),
      );
    });

    it("is not dropped on a window inside it", () => {
      const onDropOn = mock((_aim: Aim) => undefined);
      const { container } = render(
        <StripEnd {...endProps} onDropOn={onDropOn} />,
      );
      dragTo(container, 300, 200);
      expect(onDropOn).not.toHaveBeenCalled();
    });

    it("is not picked up by the middle button", () => {
      const onGrab = mock(nothing);
      const { container } = render(<StripEnd {...endProps} onGrab={onGrab} />);
      fireEvent.pointerDown(endOf(container), {
        button: MIDDLE_BUTTON,
        pointerId: 1,
      });
      expect(onGrab).not.toHaveBeenCalled();
    });
  });

  describe("the group's buttons", () => {
    it("float the group", async () => {
      await new Promise<void>((resolve) => {
        const { getByRole } = render(
          <StripEnd {...endProps} onFloat={resolve} />,
        );
        fireEvent.click(getByRole("button", { name: "Float group" }));
      });
    });

    it("fill the screen with the group", async () => {
      await new Promise<void>((resolve) => {
        const { getByRole } = render(
          <StripEnd {...endProps} onFullscreen={resolve} />,
        );
        fireEvent.click(getByRole("button", { name: "Maximize group" }));
      });
    });

    it("offer to tile a floating group and give a fullscreen one back", () => {
      const { queryByRole } = render(
        <StripEnd {...endProps} float={FLOAT} fullscreen />,
      );

      expect(queryByRole("button", { name: "Tile group" })).not.toBeNull();
      expect(queryByRole("button", { name: "Restore group" })).not.toBeNull();
    });

    it("do not pick the group up", () => {
      const onGrab = mock(nothing);
      const { getByRole } = render(<StripEnd {...endProps} onGrab={onGrab} />);
      fireEvent.pointerDown(getByRole("button", { name: "Float group" }), {
        button: 0,
        pointerId: 1,
      });
      expect(onGrab).not.toHaveBeenCalled();
    });
  });

  it("does not pick up a fullscreen group", () => {
    const onGrab = mock(nothing);
    const { container } = render(
      <StripEnd {...endProps} fullscreen onGrab={onGrab} />,
    );
    fireEvent.pointerDown(endOf(container), { button: 0, pointerId: 1 });
    expect(onGrab).not.toHaveBeenCalled();
  });

  it("moves a floating group's whole box", async () => {
    const moved = await new Promise<readonly number[]>((resolve) => {
      const { container } = render(
        <StripEnd
          {...endProps}
          float={FLOAT}
          onMove={(x, y) => {
            resolve([x, y]);
          }}
        />,
      );
      dragTo(container, 350, 60);
    });
    expect(moved).toEqual([150, 150]);
  });
});
