import { describe, expect, it, mock } from "bun:test";
import { loadEmittedStylesheet } from "@domicile-desktop/test-support/emitted-stylesheet";
import { fireEvent, render } from "@testing-library/react";
import { Direction } from "./direction";
import { scratchpadFloatFor } from "./floating/float";
import { Aim } from "./tiled/aim";
import { Layout, LayoutNode } from "./tree/node";
import { WindowTitleBar } from "./WindowTitleBar";

loadEmittedStylesheet(
  document,
  new URL("../styled-system/styles.css", import.meta.url),
);

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
  rect: TAB,
  strip: {
    at: 0,
    box: { ...TAB, width: 600 },
    divided: false,
    end: undefined,
    endDivided: false,
    group: { node: { id: "a", up: 1 }, windows: ["a"] },
    nested: false,
    open: true,
    tabs: 1,
  },
  tabbed: Layout.Tabbed,
  targets: {
    floats: [],
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
  // It hangs from the screen's top edge.
  it("squares the top corners of a scratchpad window's bar", () => {
    const { container } = render(
      <WindowTitleBar
        {...tabProps}
        float={scratchpadFloatFor(LayoutNode.Window("a"), FRAME)}
        strip={undefined}
        tabbed={undefined}
      />,
    );
    const face = bar(container).querySelector("[data-face]");
    if (face === null) {
      throw new Error("test: the title bar rendered no face");
    } else {
      expect(globalThis.getComputedStyle(face).borderStartStartRadius).toBe("");
    }
  });

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

  describe("a drag of a floating window's tab", () => {
    /** A float at (100, 100) holding `windows` as tabs. */
    const floatOf = (...windows: readonly string[]) => ({
      bare: false,
      depth: 1,
      height: 400,
      root: LayoutNode.Container(
        Layout.Tabbed,
        windows.map((id) => LayoutNode.Window(id)),
      ),
      scratchpad: false,
      width: 600,
      x: 100,
      y: 100,
    });

    /** A tiled group's tab "t" at (700, 0), to drop on. */
    const TILED_TAB = {
      at: 0,
      depth: 0,
      id: "t",
      rect: { height: 30, width: 200, x: 700, y: 0 },
      strip: { height: 30, width: 600, x: 700, y: 0 },
      tabbed: Layout.Tabbed as const,
    };

    const dragged = (float: ReturnType<typeof floatOf>) => {
      const onDropOn = mock((_aim: Aim) => undefined);
      const onMove = mock((_x: number, _y: number) => undefined);
      const { container } = render(
        <WindowTitleBar
          {...tabProps}
          float={float}
          onDropOn={onDropOn}
          onMove={onMove}
          targets={{ ...tabProps.targets, tabs: [TILED_TAB] }}
        />,
      );
      fireEvent.pointerDown(bar(container), {
        button: 0,
        clientX: 110,
        clientY: 110,
        pointerId: 1,
      });
      fireEvent.pointerMove(window, {
        clientX: 720,
        clientY: 10,
        pointerId: 1,
      });
      fireEvent.pointerUp(window, { pointerId: 1 });
      return { onDropOn, onMove };
    };

    // As in a browser: the strip's empty end moves the group.
    it("pulls the tab out of a group of several", () => {
      const { onDropOn, onMove } = dragged(floatOf("a", "b"));

      expect(onMove).not.toHaveBeenCalled();
      expect(onDropOn).toHaveBeenCalledWith(
        Aim.Window("t", Direction.Left, { ...TILED_TAB.rect, width: 100 }),
      );
    });

    it("moves a lone float, and puts it beside a tab it is let go over", () => {
      const { onDropOn, onMove } = dragged(floatOf("a"));

      expect(onMove).toHaveBeenCalledWith(710, 0);
      expect(onDropOn).toHaveBeenCalledWith(
        Aim.Window("t", Direction.Left, { ...TILED_TAB.rect, width: 100 }),
      );
    });
  });
});
