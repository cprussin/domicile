import { beforeEach, describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { act, fireEvent, renderHook } from "@testing-library/react";

import type { Focus, Spot } from "./pointer-warp";
import { usePointerWarp } from "./usePointerWarp";

const LEFT: Focus = {
  box: { height: 500, width: 400, x: 0, y: 100 },
  id: "kitty",
};
const RIGHT: Focus = {
  box: { height: 500, width: 400, x: 400, y: 100 },
  id: "emacs",
};

let warps: Spot[] = [];

/** The whole of the host this hook reaches for. */
const recordingDomicile = {
  warpPointer: (to: Spot) => {
    warps.push(to);
  },
} as unknown as DomicileClient;

const warping = (focus: Focus | undefined) =>
  renderHook(
    (current: Focus | undefined) =>
      usePointerWarp({ domicile: recordingDomicile, focus: current }),
    { initialProps: focus },
  );

const pointerAt = (x: number, y: number) => {
  fireEvent.pointerMove(document, { clientX: x, clientY: y, pointerId: 1 });
};

beforeEach(() => {
  warps = [];
});

describe("usePointerWarp", () => {
  it("takes the pointer to the window a keyed press moved the focus to", () => {
    const { rerender, result } = warping(LEFT);
    pointerAt(200, 300);

    act(() => {
      result.current();
    });
    rerender(RIGHT);

    expect(warps).toStrictEqual([[600, 350]]);
  });

  it("leaves it where it is when the focus moved on its own account", () => {
    // The pointer crossing a window is what moved this focus — `onHover` in
    // `Desktop` — and a desktop that answered by moving the pointer would be
    // chasing itself.
    const { rerender } = warping(LEFT);
    pointerAt(600, 350);
    rerender(RIGHT);

    expect(warps).toStrictEqual([]);
  });

  it("keeps up with the pointer, so a window it is already over moves nothing", () => {
    const { rerender, result } = warping(LEFT);
    pointerAt(600, 350);

    act(() => {
      result.current();
    });
    rerender(RIGHT);

    expect(warps).toStrictEqual([]);
  });

  it("does not warp twice for one press", () => {
    // The press is spent on the render that answered it. A later render — a
    // window opening, a clock ticking — is not a press, and a desktop that
    // took the pointer on one would move it while nobody was typing.
    const { rerender, result } = warping(LEFT);
    pointerAt(200, 300);

    act(() => {
      result.current();
    });
    rerender(RIGHT);
    rerender(LEFT);

    expect(warps).toStrictEqual([[600, 350]]);
  });

  it("remembers where it put the pointer", () => {
    // Nothing promises to tell this page where the pointer went: the engine
    // moves the one it draws. A page that went on believing the pointer was
    // where it last saw it would read the next press against a place the
    // pointer has not been since.
    const { rerender, result } = warping(LEFT);
    pointerAt(200, 300);

    act(() => {
      result.current();
    });
    rerender(RIGHT);
    act(() => {
      result.current();
    });
    rerender({ box: RIGHT.box, id: "firefox" });

    expect(warps).toStrictEqual([[600, 350]]);
  });
});
