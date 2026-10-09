import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";

import { Direction } from "./direction";
import { Aim } from "./tiled/aim";
import { Layout } from "./tree/node";
import { WindowTitleBar } from "./WindowTitleBar";

/** The tab's box, one bar tall. */
const TAB = { height: 30, width: 300, x: 0, y: 0 };
const FRAME = { height: 400, width: 600, x: 0, y: 0 };

/** A tiled window beside the tab's container, to drop it on. */
const OTHER = { frame: { height: 400, width: 600, x: 600, y: 0 }, id: "b" };

const MIDDLE_BUTTON = 1;

const nothing = () => undefined;

/** A tab of a tabbed container; each case overrides what it tests. */
const tabProps = {
  depth: 0,
  dragging: false,
  float: undefined,
  focus: "resting",
  frame: FRAME,
  fullscreen: false,
  groupSelected: false,
  motion: "resting",
  onAim: nothing,
  onClose: nothing,
  onDrop: nothing,
  onDropOn: nothing,
  onFloat: nothing,
  onFullscreen: nothing,
  onGrab: nothing,
  onMotionEnded: nothing,
  onMove: nothing,
  onNewTab: nothing,
  rect: TAB,
  strip: {
    at: 0,
    divided: false,
    first: true,
    open: true,
    rest: undefined,
    tabs: 1,
  },
  tabbed: Layout.Tabbed,
  targets: {
    screens: [],
    tabs: [],
    windows: [{ frame: FRAME, id: "a" }, OTHER],
  },
  title: "kitty",
  window: "a",
} as const;

const bar = (container: HTMLElement): HTMLElement => {
  const element = container.querySelector<HTMLElement>("[data-window]");
  if (element === null) {
    throw new Error("test: the title bar rendered no element");
  } else {
    return element;
  }
};

const middleClick = (element: HTMLElement): void => {
  fireEvent(
    element,
    new MouseEvent("auxclick", { bubbles: true, button: MIDDLE_BUTTON }),
  );
};

describe("WindowTitleBar", () => {
  describe("a middle click", () => {
    it("closes a tab", async () => {
      await new Promise<void>((resolve) => {
        const { container } = render(
          <WindowTitleBar {...tabProps} onClose={resolve} />,
        );
        middleClick(bar(container));
      });
    });

    it("closes a window by its own bar", async () => {
      await new Promise<void>((resolve) => {
        const { container } = render(
          <WindowTitleBar {...tabProps} onClose={resolve} tabbed={undefined} />,
        );
        middleClick(bar(container));
      });
    });
  });

  describe("a drag of a tiled window's bar", () => {
    it("picks its window up and drops it where it is aimed", () => {
      const onDropOn = mock((_aim: Aim) => undefined);
      const onAim = mock((_aim: Aim | undefined) => undefined);
      const { container } = render(
        <WindowTitleBar {...tabProps} onAim={onAim} onDropOn={onDropOn} />,
      );
      fireEvent.pointerDown(bar(container), {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 1,
      });
      fireEvent.pointerMove(window, {
        clientX: 620,
        clientY: 200,
        pointerId: 1,
      });
      fireEvent.pointerUp(window, { pointerId: 1 });
      expect(onDropOn).toHaveBeenCalledWith(
        Aim.Window(OTHER.id, Direction.Left, {
          ...OTHER.frame,
          width: OTHER.frame.width / 2,
        }),
      );
    });

    it("is not started by the middle button, which closes it instead", () => {
      const onGrab = mock(nothing);
      const { container } = render(
        <WindowTitleBar {...tabProps} onGrab={onGrab} />,
      );
      fireEvent.pointerDown(bar(container), {
        button: MIDDLE_BUTTON,
        pointerId: 1,
      });
      expect(onGrab).not.toHaveBeenCalled();
    });

    it("picks up a tiled window by its own bar too", async () => {
      await new Promise<void>((resolve) => {
        const { container } = render(
          <WindowTitleBar {...tabProps} onGrab={resolve} tabbed={undefined} />,
        );
        fireEvent.pointerDown(bar(container), { button: 0, pointerId: 1 });
      });
    });

    it("leaves a fullscreen window where it is", () => {
      const onGrab = mock(nothing);
      const { container } = render(
        <WindowTitleBar
          {...tabProps}
          fullscreen
          onGrab={onGrab}
          tabbed={undefined}
        />,
      );
      fireEvent.pointerDown(bar(container), { button: 0, pointerId: 1 });
      expect(onGrab).not.toHaveBeenCalled();
    });
  });
});
