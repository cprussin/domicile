import { describe, expect, it, mock } from "bun:test";
import { act, fireEvent, renderHook } from "@testing-library/react";

import type { Float } from "./float";
import { useFloatDrag } from "./useFloatDrag";

const FLOAT: Float = { height: 200, id: "w1", width: 300, x: 10, y: 20 };

/** A press, carrying what the hook actually reads off a pointer event. */
const press = (x = 0, y = 0) =>
  ({
    clientX: x,
    clientY: y,
    currentTarget: { setPointerCapture: () => undefined },
    pointerId: 1,
    // biome-ignore lint/suspicious/noExplicitAny: a stand-in for the fields read
  }) as any;

/**
 * The rest of a drag, which the hook listens for on `window` rather than on
 * the element the press landed on — so that is where the tests raise it.
 */
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
  const { rerender, result } = renderHook(
    (props: { resizes: boolean }) =>
      useFloatDrag({ float: FLOAT, ...calls, ...props }),
    { initialProps: { resizes } },
  );
  const grab = (x = 0, y = 0) => {
    act(() => {
      result.current.onPointerDown(press(x, y));
    });
  };
  return { calls, grab, rerender, result };
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
      // Not from the move before it: a delta applied to the box the window has
      // since been given would compound, and the window would run away from
      // the pointer at a rate of one drag per move.
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
    it("resizes the window by the pointer's delta", () => {
      const { calls, grab } = dragging(true);
      grab();
      act(() => {
        moveTo(70, 30);
      });
      expect(calls.onResize).toHaveBeenCalledWith(
        FLOAT.width + 70,
        FLOAT.height + 30,
      );
      expect(calls.onMove).not.toHaveBeenCalled();
    });

    it("goes on resizing after Shift is let go of mid-drag", () => {
      // Which it is, is read when the drag starts and then kept: a resize that
      // turned into a move half way through would jump the window to wherever
      // the pointer had got to.
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

    it("says it is resizing while it resizes, for the cursor over it", () => {
      const { grab, result } = dragging(true);
      grab();
      expect(result.current.drag).toStrictEqual({ resizes: true });
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
      // A click on the sheet: the window was grabbed, so it is drawn
      // see-through and click-through, and nothing but a drop puts it back.
      const { calls, grab } = dragging();
      grab();
      act(() => {
        release();
      });
      expect(calls.onDrop).toHaveBeenCalledTimes(1);
    });

    it("drops a grab and a release that arrive together", () => {
      // One batch, which is what a click that beats React's commit looks like:
      // the handler that sees the release was built before the grab.
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
      // A browser that ends a gesture itself sends the cancel after the
      // release, and dropping twice raises whatever ended up under the window.
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
      // The listeners are only there while a drag is, so an ordinary pointer
      // crossing the desktop moves nothing.
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
});
