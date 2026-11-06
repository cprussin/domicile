import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";

import { Direction } from "./direction";
import { GroupTitleBar } from "./GroupTitleBar";
import { Aim } from "./tiled/aim";
import { Layout } from "./tree/node";

const STRIP = { height: 30, width: 600, x: 0, y: 0 };
const rectAt = (at: number) => ({ height: 30, width: 200, x: 200 * at, y: 0 });

/** The group of "b" and "d", named after "b". */
const GROUP = { id: "b", up: 1 };

/** Its tab, first in a strip, and window "c"'s after it. */
const TABS = [
  {
    at: 0,
    depth: 0,
    node: GROUP,
    rect: rectAt(0),
    strip: STRIP,
    tabbed: Layout.Tabbed as const,
    windows: ["b", "d"],
  },
  {
    at: 1,
    depth: 0,
    node: { id: "c", up: 0 },
    rect: rectAt(1),
    strip: STRIP,
    tabbed: Layout.Tabbed as const,
    windows: ["c"],
  },
];

const nothing = () => undefined;

const props = {
  depth: 0,
  dragging: false,
  floating: false,
  focus: "resting",
  frame: rectAt(0),
  fullscreen: false,
  group: { layout: Layout.Tabbed, windows: ["b", "d"] },
  motion: "resting",
  node: GROUP,
  onAim: nothing,
  onClose: nothing,
  onDrop: nothing,
  onDropOn: nothing,
  onFloat: nothing,
  onFullscreen: nothing,
  onGrab: nothing,
  onMotionEnded: nothing,
  onPress: nothing,
  onPull: nothing,
  rect: rectAt(0),
  strip: {
    area: { ...STRIP, height: 400 },
    at: 0,
    box: STRIP,
    divided: false,
    end: undefined,
    endDivided: false,
    group: { node: { id: "b", up: 2 }, wells: 0, windows: ["b", "c", "d"] },
    nested: false,
    open: false,
    tabs: 2,
  },
  tabbed: Layout.Tabbed,
  targets: { floats: [], screens: [], tabs: TABS, windows: [] },
  title: "kitty",
  window: "b",
} as const;

const tab = (container: HTMLElement): HTMLElement => {
  const element = container.querySelector<HTMLElement>("[data-window]");
  if (element === null) {
    throw new Error("test: the tab rendered no element");
  } else {
    return element;
  }
};

const press = (element: HTMLElement): void => {
  fireEvent.pointerDown(element, {
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 1,
  });
};

describe("GroupTitleBar", () => {
  it("shows its group's windows on a press", async () => {
    await new Promise<void>((resolve) => {
      const { container } = render(
        <GroupTitleBar {...props} onPress={resolve} />,
      );
      press(tab(container));
    });
  });

  it("moves its group along its strip", () => {
    const onDropOn = mock((_aim: Aim) => undefined);
    const { container } = render(
      <GroupTitleBar {...props} onDropOn={onDropOn} />,
    );
    press(tab(container));
    fireEvent.pointerMove(window, { clientX: 250, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(onDropOn.mock.calls).toEqual([
      [Aim.Strip({ id: "c", up: 0 }, Direction.Right, rectAt(1))],
    ]);
  });
});
