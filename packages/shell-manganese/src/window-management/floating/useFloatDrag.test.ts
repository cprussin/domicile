import { describe, expect, it, mock } from "bun:test";
import { act, fireEvent, renderHook } from "@testing-library/react";

import { Direction } from "../direction";
import { LayoutNode } from "../tree/node";
import type { Float } from "./float";
import { useFloatDrag } from "./useFloatDrag";

const FLOAT: Float = {
  depth: 0,
  height: 200,
  root: LayoutNode.Window("w1"),
  scratchpad: false,
  width: 300,
  x: 10,
  y: 20,
};

/** A press with only the pointer-event fields the hook reads. */
const press = (x = 0, y = 0, button = 0) =>
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

/** A point in the window's bottom-right quarter, for a corner resize. */
const BOTTOM_RIGHT = [
  FLOAT.x + FLOAT.width - 1,
  FLOAT.y + FLOAT.height - 1,
] as const;

/** The rest of a drag, raised on `window` where the hook listens. */
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
    onDrop: mock(() => undefined),
    onGrab: mock(() => undefined),
    onMove: mock(() => undefined),
    onResize: mock(() => undefined),
  };
  const { rerender, result, unmount } = renderHook(
    (props: { resizes: boolean }) =>
      useFloatDrag({ float: FLOAT, ...calls, ...props }),
    { initialProps: { resizes } },
  );
  const grab = (x = 0, y = 0) => {
    act(() => {
      result.current.onPointerDown(press(x, y));
    });
  };
  return { calls, grab, rerender, result, unmount };
};

describe("useFloatDrag", () => {
  describe("moving", () => {
    it("moves the window by the pointer's delta", () => {
      const { calls, grab } = dragging();
      grab();
      act(() => {
        moveTo(70, 30);
      });
      expect(calls.onMove).toHaveBeenCalledWith(FLOAT.x + 70, FLOAT.y + 30);
    });

    it("measures every move from where the drag started", () => {
      // The delta is from the press, not the last move; otherwise deltas
      // would compound and the window would outrun the pointer.
      const { calls, grab } = dragging();
      grab();
      act(() => {
        moveTo(70, 30);
      });
      act(() => {
        moveTo(90, 40);
      });
      expect(calls.onMove).toHaveBeenLastCalledWith(FLOAT.x + 90, FLOAT.y + 40);
    });

    it("takes the press's own position as the origin", () => {
      const { calls, grab } = dragging();
      grab(500, 400);
      act(() => {
        moveTo(560, 430);
      });
      expect(calls.onMove).toHaveBeenCalledWith(FLOAT.x + 60, FLOAT.y + 30);
    });

    it("grabs the window as soon as it is pressed", () => {
      const { calls, grab } = dragging();
      grab();
      expect(calls.onGrab).toHaveBeenCalledTimes(1);
    });
  });

  describe("resizing", () => {
    it("drags the bottom-right corner when taken hold of near it", () => {
      const { calls, grab } = dragging(true);
      grab(...BOTTOM_RIGHT);
      act(() => {
        moveTo(BOTTOM_RIGHT[0] + 70, BOTTOM_RIGHT[1] + 30);
      });
      expect(calls.onResize).toHaveBeenCalledWith({
        height: FLOAT.height + 30,
        width: FLOAT.width + 70,
        x: FLOAT.x,
        y: FLOAT.y,
      });
      expect(calls.onMove).not.toHaveBeenCalled();
    });

    it("drags the top-left corner when taken hold of near it", () => {
      // As in sway, the dragged corner is the one in the pointer's quarter.
      const { calls, grab } = dragging(true);
      grab(FLOAT.x + 1, FLOAT.y + 1);
      act(() => {
        moveTo(FLOAT.x - 4, FLOAT.y - 9);
      });
      expect(calls.onResize).toHaveBeenCalledWith({
        height: FLOAT.height + 10,
        width: FLOAT.width + 5,
        x: FLOAT.x - 5,
        y: FLOAT.y - 10,
      });
    });

    it("goes on resizing after Shift is let go of mid-drag", () => {
      // The mode is fixed at the start; switching mid-drag would make the
      // window jump.
      const { calls, grab, rerender } = dragging(true);
      grab();
      act(() => {
        rerender({ resizes: false });
      });
      act(() => {
        moveTo(70, 30);
      });
      expect(calls.onResize).toHaveBeenCalledTimes(1);
      expect(calls.onMove).not.toHaveBeenCalled();
    });

    it("resizes when the drag is taken hold of with the secondary button", () => {
      // The right button resizes without a second modifier.
      const { calls, result } = dragging();
      act(() => {
        result.current.onPointerDown(press(...BOTTOM_RIGHT, SECONDARY));
      });
      act(() => {
        moveTo(BOTTOM_RIGHT[0] + 70, BOTTOM_RIGHT[1] + 30);
      });
      expect(calls.onResize).toHaveBeenCalledWith({
        height: FLOAT.height + 30,
        width: FLOAT.width + 70,
        x: FLOAT.x,
        y: FLOAT.y,
      });
      expect(calls.onMove).not.toHaveBeenCalled();
    });

    it("says which corner it is resizing from, for the cursor over it", () => {
      const { grab, result } = dragging(true);
      grab(...BOTTOM_RIGHT);
      expect(result.current.drag).toStrictEqual({
        corner: { horizontal: Direction.Right, vertical: Direction.Down },
      });
    });
  });

  describe("a window that leaves the screen it was pressed on", () => {
    // The window crossed onto another screen, so the pressed element unmounts
    // while the button is still down.
    it("goes on following the pointer", () => {
      const { calls, grab, unmount } = dragging();
      grab();
      unmount();
      act(() => {
        moveTo(70, 30);
      });
      expect(calls.onMove).toHaveBeenCalledWith(FLOAT.x + 70, FLOAT.y + 30);
    });

    it("drops the window where the pointer lets go, and then listens no more", () => {
      const { calls, grab, unmount } = dragging();
      grab();
      unmount();
      act(() => {
        release();
      });
      act(() => {
        moveTo(500, 500);
      });
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
      expect(calls.onMove).not.toHaveBeenCalled();
    });
  });

  describe("ending a drag", () => {
    it("drops a drag that moved", () => {
      const { calls, grab } = dragging();
      grab();
      act(() => {
        moveTo(70, 30);
      });
      act(() => {
        release();
      });
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
    });

    it("drops a grab that never moved", () => {
      // A click grabs the window, and only a drop restores it.
      const { calls, grab } = dragging();
      grab();
      act(() => {
        release();
      });
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
    });

    it("drops a grab and a release that arrive together", () => {
      // One batch simulates a click whose release beats React's commit.
      const { calls, result } = dragging();
      act(() => {
        result.current.onPointerDown(press());
        release();
      });
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
    });

    it("drops a drag the browser cancels", () => {
      const { calls, grab } = dragging();
      grab();
      act(() => {
        cancel();
      });
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
    });

    it("drops only once when a release and a cancel both arrive", () => {
      // A browser can send a cancel after the release; dropping twice would
      // raise whatever is underneath.
      const { calls, grab } = dragging();
      grab();
      act(() => {
        release();
        cancel();
      });
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
    });

    it("stops moving the window once it has been dropped", () => {
      const { calls, grab } = dragging();
      grab();
      act(() => {
        release();
      });
      act(() => {
        moveTo(500, 500);
      });
      expect(calls.onMove).not.toHaveBeenCalled();
    });

    it("says nothing is dragging once the drag has ended", () => {
      const { grab, result } = dragging();
      grab();
      act(() => {
        release();
      });
      expect(result.current.drag).toBeUndefined();
    });
  });

  describe("with no drag running", () => {
    it("does not drop a release that follows no grab", () => {
      const { calls } = dragging();
      act(() => {
        release();
      });
      expect(calls.onDrop).not.toHaveBeenCalled();
    });

    it("ignores a move that follows no grab", () => {
      // Listeners exist only during a drag.
      const { calls } = dragging();
      act(() => {
        moveTo(70, 30);
      });
      expect(calls.onMove).not.toHaveBeenCalled();
    });

    it("says nothing is dragging before anything is pressed", () => {
      const { result } = dragging();
      expect(result.current.drag).toBeUndefined();
    });
  });

  describe("with no floating window", () => {
    // A tiled window's title bar uses this hook too, with no float to drag.
    it("throws when pressed", () => {
      const { result } = renderHook(() =>
        useFloatDrag({
          float: undefined,
          onDrop: () => undefined,
          onGrab: () => undefined,
          onMove: () => undefined,
          onResize: () => undefined,
          resizes: false,
        }),
      );
      expect(() => {
        result.current.onPointerDown(press());
      }).toThrow("no floating window");
    });
  });
});
