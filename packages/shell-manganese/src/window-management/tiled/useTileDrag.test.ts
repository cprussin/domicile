import { describe, expect, it, mock } from "bun:test";
import { act, fireEvent, renderHook } from "@testing-library/react";

import { Direction } from "../direction";
import type { Aim } from "./aim";
import { useTileDrag } from "./useTileDrag";

const DRAGGED = { frame: { height: 400, width: 500, x: 0, y: 0 }, id: "a" };
const OTHER = { frame: { height: 400, width: 500, x: 500, y: 0 }, id: "b" };

/** A press with only the pointer-event fields the hook reads. */
const press = (x: number, y: number, button = 0) =>
  ({
    button,
    clientX: x,
    clientY: y,
    currentTarget: { setPointerCapture: () => undefined },
    pointerId: 1,
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the fields read
  }) as any;

/** The secondary button, which resizes. */
const SECONDARY = 2;

const moveTo = (x: number, y: number): void => {
  fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerId: 1 });
};
const release = (): void => {
  fireEvent.pointerUp(window, { pointerId: 1 });
};
const cancel = (): void => {
  fireEvent.pointerCancel(window, { pointerId: 1 });
};

const dragging = (resizes = false) => {
  const calls = {
    onAim: mock((_aim: Aim | undefined) => undefined),
    onDrop: mock(() => undefined),
    onDropOn: mock(
      (_target: string, _edge: Direction | undefined) => undefined,
    ),
    onGrab: mock((_resizing: boolean) => undefined),
    onStretch: mock((_edge: Direction, _by: number) => undefined),
  };
  const { result } = renderHook(() =>
    useTileDrag({
      frame: DRAGGED.frame,
      id: DRAGGED.id,
      resizes,
      targets: [DRAGGED, OTHER],
      ...calls,
    }),
  );
  const grab = (x: number, y: number, button = 0) => {
    act(() => {
      result.current.onPointerDown(press(x, y, button));
    });
  };
  return { calls, grab, result };
};

describe("useTileDrag", () => {
  describe("moving", () => {
    it("grabs the window as soon as it is pressed", () => {
      const { calls, grab } = dragging();
      grab(100, 100);
      expect(calls.onGrab.mock.calls).toEqual([[false]]);
    });

    it("aims at the window under the pointer, and drops it there", () => {
      const { calls, grab } = dragging();
      grab(100, 100);
      act(() => {
        moveTo(520, 200);
      });
      expect(calls.onAim).toHaveBeenLastCalledWith({
        edge: Direction.Left,
        id: OTHER.id,
        rect: { height: 400, width: 250, x: 500, y: 0 },
      });
      act(() => {
        release();
      });
      expect(calls.onDropOn).toHaveBeenCalledWith(OTHER.id, Direction.Left);
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
      expect(calls.onAim).toHaveBeenLastCalledWith(undefined);
    });

    it("says where it would land only when that changes", () => {
      // Only changes are reported, to avoid a redraw on every move.
      const { calls, grab } = dragging();
      grab(100, 100);
      act(() => {
        moveTo(750, 200);
        moveTo(760, 210);
        moveTo(200, 200);
        moveTo(210, 210);
      });
      expect(calls.onAim.mock.calls).toEqual([
        [{ edge: undefined, id: OTHER.id, rect: OTHER.frame }],
        [undefined],
      ]);
    });

    it("drops it nowhere when let go of over nothing to drop it on", () => {
      const { calls, grab } = dragging();
      grab(100, 100);
      act(() => {
        moveTo(200, 200);
        release();
      });
      expect(calls.onDropOn).not.toHaveBeenCalled();
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
    });

    it("drops nowhere when the pointer barely moves, as in a click", () => {
      // A tab's strip is inside the open tab's window, so a click's jitter
      // would otherwise drop the tab beside it.
      const { calls, grab } = dragging();
      grab(520, 200);
      act(() => {
        moveTo(523, 203);
        release();
      });
      // Only the drop's clearing of the aim.
      expect(calls.onAim.mock.calls).toEqual([[undefined]]);
      expect(calls.onDropOn).not.toHaveBeenCalled();
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
    });

    it("keeps aiming once pulled away, even back where it was pressed", () => {
      const { calls, grab } = dragging();
      grab(520, 200);
      act(() => {
        moveTo(750, 200);
        moveTo(520, 200);
        release();
      });
      expect(calls.onDropOn).toHaveBeenCalledWith(OTHER.id, Direction.Left);
    });

    it("drops only once when a release and a cancel both arrive", () => {
      const { calls, grab } = dragging();
      grab(100, 100);
      act(() => {
        moveTo(750, 200);
        release();
        cancel();
      });
      expect(calls.onDropOn).toHaveBeenCalledTimes(1);
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
    });
  });

  describe("resizing", () => {
    it("drags the edges of the quarter it took hold of, move by move", () => {
      // Deltas are per move: the tree stores shares, so a delta from the press
      // would be applied to a tree already stretched.
      const { calls, grab } = dragging(true);
      grab(400, 300);
      act(() => {
        moveTo(430, 320);
      });
      act(() => {
        moveTo(440, 320);
      });
      expect(calls.onStretch.mock.calls).toEqual([
        [Direction.Right, 30],
        [Direction.Down, 20],
        [Direction.Right, 10],
      ]);
      expect(calls.onAim).not.toHaveBeenCalled();
    });

    it("grabs the window as a resize, so it does not fade like a move", () => {
      const { calls, grab } = dragging(true);
      grab(400, 300);
      expect(calls.onGrab.mock.calls).toEqual([[true]]);
    });

    it("says which corner it is resizing from, for the cursor over it", () => {
      const { grab, result } = dragging(true);
      grab(10, 390);
      expect(result.current.drag).toStrictEqual({
        corner: { horizontal: Direction.Left, vertical: Direction.Down },
      });
    });

    it("resizes when taken hold of with the secondary button", () => {
      const { calls, grab } = dragging();
      grab(100, 100, SECONDARY);
      act(() => {
        moveTo(90, 100);
      });
      expect(calls.onStretch).toHaveBeenCalledWith(Direction.Left, -10);
    });

    it("drops nothing on the window it ends over", () => {
      const { calls, grab } = dragging(true);
      grab(400, 300);
      act(() => {
        moveTo(750, 200);
        release();
      });
      expect(calls.onDropOn).not.toHaveBeenCalled();
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
    });
  });

  it("ignores a move that follows no grab", () => {
    const { calls } = dragging();
    act(() => {
      moveTo(750, 200);
      release();
    });
    expect(calls.onAim).not.toHaveBeenCalled();
    expect(calls.onDrop).not.toHaveBeenCalled();
  });
});
