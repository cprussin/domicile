import { describe, expect, it, mock } from "bun:test";
import { act, fireEvent, renderHook } from "@testing-library/react";

import { Direction } from "../direction";
import { useBorderDrag } from "./useBorderDrag";

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

const dragging = (edge: Direction) => {
  const calls = {
    onDrop: mock(() => undefined),
    onGrab: mock(() => undefined),
    onStretch: mock((_edge: Direction, _by: number) => undefined),
  };
  const { result } = renderHook(() => useBorderDrag({ edge, ...calls }));
  act(() => {
    result.current.onPointerDown(press(100, 100));
  });
  return calls;
};

describe("useBorderDrag", () => {
  it("grabs the window as soon as its border is pressed", () => {
    const calls = dragging(Direction.Right);
    expect(calls.onGrab).toHaveBeenCalledTimes(1);
  });

  it("stretches the edge by what the pointer moved along its axis alone", () => {
    const calls = dragging(Direction.Down);
    act(() => {
      moveTo(130, 100);
      moveTo(140, 90);
      moveTo(140, 115);
    });
    expect(calls.onStretch.mock.calls).toEqual([
      [Direction.Down, -10],
      [Direction.Down, 25],
    ]);
  });

  it("drops only once when a release and a cancel both arrive", () => {
    const calls = dragging(Direction.Left);
    act(() => {
      fireEvent.pointerUp(window, { pointerId: 1 });
      fireEvent.pointerCancel(window, { pointerId: 1 });
      moveTo(200, 100);
    });
    expect(calls.onDrop).toHaveBeenCalledTimes(1);
    expect(calls.onStretch).not.toHaveBeenCalled();
  });
});
