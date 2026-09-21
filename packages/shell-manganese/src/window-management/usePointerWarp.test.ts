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

/**
 * One render of the desktop: where the keyboard is, and what windows there
 * are.
 *
 * Both, because the hook answers two questions off them — whether the focus
 * moved, and whether the window it is on is one that has only just opened.
 */
type Desktop = {
  focus: Focus | undefined;
  windows: readonly string[];
};

/** A desktop with nothing on it, which is what the chrome always mounts on. */
const NOTHING: Desktop = { focus: undefined, windows: [] };

/**
 * The hook, on a desktop that has reached `desktop` the way a real one does:
 * mounted with nothing on it, and the windows opened into it.
 *
 * Mounted empty rather than handed its windows, because a window arriving is
 * itself one of the things this hook answers — a fixture that started with
 * them would be asserting against a state the chrome is never in. What those
 * openings moved is cleared before the case begins.
 */
const warping = (desktop: Desktop) => {
  const view = renderHook(
    (current: Desktop) =>
      usePointerWarp({
        domicile: recordingDomicile,
        focus: current.focus,
        windows: current.windows,
      }),
    { initialProps: NOTHING },
  );
  view.rerender(desktop);
  warps = [];
  return view;
};

/** A desktop of `windows`, with the keyboard on `focus`. */
const desktopOf = (focus: Focus, windows: readonly string[]): Desktop => ({
  focus,
  windows,
});

/** The pair of windows every case but the opening ones starts from. */
const BOTH = [LEFT.id, RIGHT.id];

const pointerAt = (x: number, y: number) => {
  fireEvent.pointerMove(document, { clientX: x, clientY: y, pointerId: 1 });
};

beforeEach(() => {
  warps = [];
});

describe("usePointerWarp", () => {
  it("takes the pointer to the window a keyed press moved the focus to", () => {
    const { rerender, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    act(() => {
      result.current();
    });
    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([[600, 350]]);
  });

  it("leaves it where it is when the focus moved on its own account", () => {
    // The pointer crossing a window is what moved this focus — `onHover` in
    // `Desktop` — and a desktop that answered by moving the pointer would be
    // chasing itself.
    const { rerender } = warping(desktopOf(LEFT, BOTH));
    pointerAt(600, 350);
    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([]);
  });

  it("keeps up with the pointer, so a window it is already over moves nothing", () => {
    const { rerender, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(600, 350);

    act(() => {
      result.current();
    });
    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([]);
  });

  it("does not warp twice for one press", () => {
    // The press is spent on the render that answered it. A later render — a
    // clock ticking, a window renaming itself — is not a press, and a desktop
    // that took the pointer on one would move it while nobody was typing.
    const { rerender, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    act(() => {
      result.current();
    });
    rerender(desktopOf(RIGHT, BOTH));
    rerender(desktopOf(LEFT, BOTH));

    expect(warps).toStrictEqual([[600, 350]]);
  });

  it("takes the pointer to a window that has just opened", () => {
    // A window opens on the workspace being looked at and takes the keyboard,
    // and nobody pressed a key for it: a terminal finishing its startup, a
    // link opening a browser window. The pointer is still over whatever the
    // new window was laid out beside, which is what would take the focus back.
    const { rerender } = warping(desktopOf(LEFT, [LEFT.id]));
    pointerAt(200, 300);

    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([[600, 350]]);
  });

  it("does not take it again once that window is no longer new", () => {
    const { rerender } = warping(desktopOf(LEFT, [LEFT.id]));
    pointerAt(200, 300);

    rerender(desktopOf(RIGHT, BOTH));
    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([[600, 350]]);
  });

  it("leaves the pointer alone for a window that opens somewhere it is not", () => {
    // Only the window that TOOK the keyboard is a reason to move the pointer.
    // One that opens without it — on another workspace — has nothing to do
    // with where the user is working.
    const { rerender } = warping(desktopOf(LEFT, [LEFT.id]));
    pointerAt(200, 300);

    rerender(desktopOf(LEFT, BOTH));

    expect(warps).toStrictEqual([]);
  });

  it("remembers where it put the pointer", () => {
    // Nothing promises to tell this page where the pointer went: the engine
    // moves the one it draws. A page that went on believing the pointer was
    // where it last saw it would read the next press against a place the
    // pointer has not been since.
    const all = [...BOTH, "firefox"];
    const { rerender, result } = warping(desktopOf(LEFT, all));
    pointerAt(200, 300);

    act(() => {
      result.current();
    });
    rerender(desktopOf(RIGHT, all));
    act(() => {
      result.current();
    });
    rerender(desktopOf({ box: RIGHT.box, id: "firefox" }, all));

    expect(warps).toStrictEqual([[600, 350]]);
  });
});
