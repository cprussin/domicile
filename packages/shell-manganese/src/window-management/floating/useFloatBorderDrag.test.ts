import { describe, expect, it, mock } from "bun:test";
import { act, fireEvent, renderHook } from "@testing-library/react";

import { Direction } from "../direction";
import type { Rect } from "../rect";
import { LayoutNode } from "../tree/node";
import type { Float, Grip } from "./float";
import { useFloatBorderDrag } from "./useFloatBorderDrag";

const AT: Float = {
  depth: 0,
  height: 400,
  root: LayoutNode.Window("w1"),
  scratchpad: false,
  width: 600,
  x: 100,
  y: 80,
};

/** A press, carrying what the hook actually reads off a pointer event. */
const press = (x: number, y: number) =>
  ({
    clientX: x,
    clientY: y,
    currentTarget: { setPointerCapture: () => undefined },
    pointerId: 1,
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the fields read
  }) as any;

const moveTo = (x: number, y: number): void => {
  fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerId: 1 });
};

const dragging = (grip: Grip) => {
  const calls = {
    onDrop: mock(() => undefined),
    onGrab: mock(() => undefined),
    onResize: mock((_box: Rect) => undefined),
  };
  const { result } = renderHook(() =>
    useFloatBorderDrag({ float: AT, grip, ...calls }),
  );
  act(() => {
    result.current.onPointerDown(press(700, 300));
  });
  return calls;
};

describe("useFloatBorderDrag", () => {
  it("grabs the window as soon as its border is pressed", () => {
    const calls = dragging({
      horizontal: Direction.Right,
      vertical: undefined,
    });
    expect(calls.onGrab).toHaveBeenCalledTimes(1);
  });

  it("resizes from the box it was pressed on, by the edges the border holds", () => {
    const calls = dragging({
      horizontal: Direction.Right,
      vertical: undefined,
    });
    act(() => {
      moveTo(720, 310);
      moveTo(750, 280);
    });
    expect(calls.onResize.mock.calls).toEqual([
      [{ height: 400, width: 620, x: 100, y: 80 }],
      [{ height: 400, width: 650, x: 100, y: 80 }],
    ]);
  });

  it("drops only once when a release and a cancel both arrive", () => {
    const calls = dragging({
      horizontal: Direction.Left,
      vertical: Direction.Up,
    });
    act(() => {
      fireEvent.pointerUp(window, { pointerId: 1 });
      fireEvent.pointerCancel(window, { pointerId: 1 });
      moveTo(800, 300);
    });
    expect(calls.onDrop).toHaveBeenCalledTimes(1);
    expect(calls.onResize).not.toHaveBeenCalled();
  });
});
