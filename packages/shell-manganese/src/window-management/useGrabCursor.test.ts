import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import { Direction } from "./direction";
import { GrabCursor, useGrabCursor } from "./useGrabCursor";

const FRAME = { height: 200, width: 300, x: 100, y: 100 };

const TOP_RIGHT = { horizontal: Direction.Right, vertical: Direction.Up };

type Props = Parameters<typeof useGrabCursor>[0];

const rendered = (props: Omit<Props, "frame">) => {
  const { rerender, result } = renderHook(
    (next: Props) => useGrabCursor(next),
    {
      initialProps: { frame: FRAME, ...props },
    },
  );
  const hoverAt = (x: number, y: number) => {
    act(() => {
      result.current.onPointerMove({ clientX: x, clientY: y });
    });
  };
  return { hoverAt, rerender, result };
};

describe("useGrabCursor", () => {
  it("is a move while taking hold would move the window", () => {
    const { hoverAt, result } = rendered({ drag: undefined, resizes: false });
    hoverAt(390, 110);
    expect(result.current.cursor).toBe(GrabCursor.Move);
  });

  it("points along the diagonal of the quarter the pointer is over", () => {
    const { hoverAt, result } = rendered({ drag: undefined, resizes: true });
    hoverAt(390, 110);
    expect(result.current.cursor).toBe(GrabCursor.ResizeNesw);
    hoverAt(110, 110);
    expect(result.current.cursor).toBe(GrabCursor.ResizeNwse);
  });

  it("keeps to the corner a resize took hold of, wherever the pointer goes", () => {
    // The window moves under the pointer as it is resized, so the quarter the
    // pointer is over now says nothing about which corner is being dragged.
    const { hoverAt, result } = rendered({
      drag: { corner: TOP_RIGHT },
      resizes: true,
    });
    hoverAt(110, 290);
    expect(result.current.cursor).toBe(GrabCursor.ResizeNesw);
  });

  it("is a move while a move runs, even with Shift pressed since", () => {
    const { result } = rendered({ drag: { corner: undefined }, resizes: true });
    expect(result.current.cursor).toBe(GrabCursor.Move);
  });
});
