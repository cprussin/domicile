import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { act, fireEvent, renderHook } from "@testing-library/react";

import { capturingElement } from "../captured-element";
import { Direction } from "../direction";
import type { Rect } from "../rect";
import { LayoutNode } from "../tree/node";
import type { Float, Grip } from "./float";
import { useFloatBorderDrag } from "./useFloatBorderDrag";

const AT: Float = {
  bare: false,
  depth: 0,
  height: 400,
  root: LayoutNode.Window("w1"),
  scratchpad: false,
  width: 600,
  x: 100,
  y: 80,
};

/** A press, carrying what the hook actually reads off a pointer event. */
const press = (x: number, y: number, border = capturingElement()) =>
  ({
    clientX: x,
    clientY: y,
    currentTarget: border,
    pointerId: 1,
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the fields read
  }) as any;

/** A move with the button still held, as every move in a drag is. */
const moveTo = (x: number, y: number): void => {
  fireEvent.pointerMove(window, {
    buttons: 1,
    clientX: x,
    clientY: y,
    pointerId: 1,
  });
};

const dragging = (grip: Grip, border = capturingElement()) => {
  const calls = {
    onDrop: mock(() => undefined),
    onGrab: mock(() => undefined),
    onResize: mock((_box: Rect) => undefined),
  };
  const { result } = renderHook(() =>
    useFloatBorderDrag({ float: AT, grip, ...calls }),
  );
  act(() => {
    result.current.onPointerDown(press(700, 300, border));
  });
  return calls;
};

afterEach(() => {
  mock.restore();
});

describe("useFloatBorderDrag", () => {
  // Every float border has the hook, so only a drag listens to the page.
  it("listens for the pointer only while a drag runs", () => {
    const added = spyOn(window, "addEventListener");
    const removed = spyOn(window, "removeEventListener");
    const moves = (spy: typeof added) =>
      spy.mock.calls.filter(([type]) => type === "pointermove").length;
    const { result } = renderHook(() =>
      useFloatBorderDrag({
        float: AT,
        grip: { horizontal: Direction.Right, vertical: undefined },
        onDrop: () => undefined,
        onGrab: () => undefined,
        onResize: () => undefined,
      }),
    );
    expect(moves(added)).toBe(0);

    act(() => {
      result.current.onPointerDown(press(700, 300));
    });
    expect(moves(added)).toBe(1);

    act(() => {
      fireEvent.pointerUp(window, { pointerId: 1 });
    });
    expect(moves(removed)).toBe(1);
  });

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

  // See `followPress`.
  it("drops a release the page missed, and lets go of the pointer", () => {
    const border = capturingElement();
    const calls = dragging(
      { horizontal: Direction.Right, vertical: undefined },
      border,
    );
    act(() => {
      fireEvent.pointerMove(window, {
        buttons: 0,
        clientX: 800,
        clientY: 300,
        pointerId: 1,
      });
    });
    expect(calls.onDrop).toHaveBeenCalledTimes(1);
    expect(calls.onResize).not.toHaveBeenCalled();
    expect(border.hasPointerCapture(1)).toBe(false);
  });
});
