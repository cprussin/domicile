import { describe, expect, it, mock } from "bun:test";
import { act, fireEvent, renderHook } from "@testing-library/react";

import { Direction } from "../direction";
import { Layout } from "../tree/node";
import { Aim } from "./aim";
import { useTileDrag } from "./useTileDrag";

const DRAGGED = { frame: { height: 400, width: 500, x: 0, y: 0 }, id: "a" };
const OTHER = { frame: { height: 400, width: 500, x: 500, y: 0 }, id: "b" };
/** A drop on the left half of {@link OTHER}. */
const LEFT_OF_OTHER = Aim.Window(OTHER.id, Direction.Left, {
  height: 400,
  width: 250,
  x: 500,
  y: 0,
});

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
    onDropOn: mock((_aim: Aim) => undefined),
    onGrab: mock((_resizing: boolean) => undefined),
    onStretch: mock((_edge: Direction, _by: number) => undefined),
  };
  const { result } = renderHook(() =>
    useTileDrag({
      dragged: [DRAGGED.id],
      frame: DRAGGED.frame,
      resizes,
      targets: { screens: [], tabs: [], windows: [DRAGGED, OTHER] },
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
      expect(calls.onAim).toHaveBeenLastCalledWith(LEFT_OF_OTHER);
      act(() => {
        release();
      });
      expect(calls.onDropOn).toHaveBeenCalledWith(LEFT_OF_OTHER);
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
        [Aim.Window(OTHER.id, undefined, OTHER.frame)],
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
      expect(calls.onDropOn).toHaveBeenCalledWith(LEFT_OF_OTHER);
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

  describe("moving a tab along its strip", () => {
    const STRIP = { height: 30, width: 1000, x: 0, y: 0 };
    const tabAt = (id: string, at: number) => ({
      at,
      id,
      rect: { height: 30, width: 200, x: 200 * at, y: 0 },
      strip: STRIP,
      tabbed: Layout.Tabbed as const,
    });
    const targetsOf = (tabs: readonly string[]) => ({
      screens: [],
      tabs: tabs.map(tabAt),
      windows: [],
    });

    const draggingTab = () => {
      const onAim = mock((_aim: Aim | undefined) => undefined);
      const onDropOn = mock((_aim: Aim) => undefined);
      const { rerender, result } = renderHook(
        ({ targets }) =>
          useTileDrag({
            dragged: ["a"],
            frame: DRAGGED.frame,
            onAim,
            onDrop: () => undefined,
            onDropOn,
            onGrab: () => undefined,
            onStretch: () => undefined,
            resizes: false,
            targets,
          }),
        { initialProps: { targets: targetsOf(["a", "b"]) } },
      );
      act(() => {
        result.current.onPointerDown(press(100, 10));
      });
      return { onAim, onDropOn, rerender };
    };

    it("moves it at once, with no drop indicator", () => {
      const { onAim, onDropOn } = draggingTab();
      act(() => {
        moveTo(300, 10);
      });
      expect(onDropOn.mock.calls).toEqual([
        [Aim.Strip("b", Direction.Right, tabAt("b", 1).rect)],
      ]);
      act(() => {
        release();
      });
      expect(onDropOn).toHaveBeenCalledTimes(1);
      expect(onAim.mock.calls).toEqual([[undefined]]);
    });

    it("aims at the tabs where they are after the move", () => {
      const { onDropOn, rerender } = draggingTab();
      act(() => {
        moveTo(300, 10);
      });
      rerender({ targets: targetsOf(["b", "a"]) });
      act(() => {
        moveTo(100, 10);
      });
      expect(onDropOn).toHaveBeenLastCalledWith(
        Aim.Strip("b", Direction.Left, tabAt("b", 0).rect),
      );
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
