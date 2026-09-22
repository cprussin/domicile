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

/**
 * The place the warp at `at` asked for.
 *
 * Throws where there is no such warp, rather than standing a place in for
 * one: `[0, 0]` is a spot this hook answers for like any other, so a case
 * that asked about a warp which never happened would pass on the answer to a
 * question it did not mean to ask.
 */
const warpNumber = (at: number): Spot => {
  const asked = warps[at];
  if (asked === undefined) {
    throw new Error(`test: the hook asked for no warp number ${at.toString()}`);
  } else {
    return asked;
  }
};

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
      result.current.keyed();
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
      result.current.keyed();
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
      result.current.keyed();
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

  it("reads a window arriving where the pointer already is as no pointing", () => {
    // The layout moving under a stationary hand fires `pointerover` the same
    // way the pointer crossing a window does, and the desktop has to tell
    // the two apart: one is the user choosing a window, the other is the
    // desktop rearranging itself around a hand that has not moved. The place
    // the event carries is what says which — a window that arrived under the
    // pointer arrives at the pointer's own spot.
    const { result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    expect(result.current.pointing([200, 300])).toBe(false);
  });

  it("reads one the pointer crossed into as pointing", () => {
    const { result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    expect(result.current.pointing([240, 300])).toBe(true);
  });

  it("still reads the place it left as where the pointer is, after a warp", () => {
    // The engine is asked to move the cursor and the page is told nothing
    // about it having happened, so between the ask and the arrival there are
    // two places the cursor may be — and a window arriving at either of them
    // is a window that came to the pointer.
    const { rerender, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    act(() => {
      result.current.keyed();
    });
    rerender(desktopOf(RIGHT, BOTH));

    expect(result.current.pointing([200, 300])).toBe(false);
  });

  it("counts where it put the pointer itself as where the pointer is", () => {
    // The warp is the desktop moving the cursor, so the window it lands on
    // is not one the user pointed at — and the window it lands on first may
    // not even be the one it was aimed at, because the boxes are still
    // easing towards where the press put them.
    const { rerender, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    act(() => {
      result.current.keyed();
    });
    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([[600, 350]]);
    expect(result.current.pointing([600, 350])).toBe(false);
  });

  it("answers for a pointer it has never seen at all", () => {
    // The engine draws a cursor and says nothing about where: a desktop that
    // took its own guess for the pointer's place would swallow the first
    // window the user crossed into.
    const { result } = warping(desktopOf(LEFT, BOTH));

    expect(result.current.pointing([200, 300])).toBe(true);
  });

  it("remembers every place it has asked for that nothing has reached yet", () => {
    // A second press before the first warp has landed: the engine is asked
    // twice and answers twice, and both answers are the desktop's own move
    // rather than a hand. One slot for the place asked for would forget the
    // first, and the window it came down on would be read as pointed at.
    const { rerender, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    act(() => {
      result.current.keyed();
    });
    rerender(desktopOf(RIGHT, BOTH));
    act(() => {
      result.current.keyed();
    });
    rerender(desktopOf(LEFT, BOTH));

    expect(warps).toStrictEqual([
      [600, 350],
      [200, 350],
    ]);
    expect(result.current.pointing([600, 350])).toBe(false);
    expect(result.current.pointing([200, 350])).toBe(false);
  });

  it("gives up on a place it asked for once a later one is reached", () => {
    // Warps are carried out in order, so something turning up at the second
    // says the first will never be answered — the engine coalesces two
    // cursor moves in a frame into the last of them, and the crossing the
    // skipped one would have fired is never dispatched. Kept anyway, that
    // first place is where this page thinks the cursor is, and the next
    // press is measured against somewhere it has not been: the window the
    // keyboard moves to looks like the one the pointer is already in, and
    // the pointer is left behind.
    const { rerender, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    act(() => {
      result.current.keyed();
    });
    rerender(desktopOf(RIGHT, BOTH));
    act(() => {
      result.current.keyed();
    });
    rerender(desktopOf(LEFT, BOTH));
    warps = [];

    // Only the second of the two lands anywhere this page hears about.
    pointerAt(200, 350);
    act(() => {
      result.current.keyed();
    });
    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([[600, 350]]);
    expect(result.current.pointing([600, 350])).toBe(false);
  });

  it("answers every landing when the engine reports each of them", () => {
    // Three presses, the third aiming back where the first did — and the
    // engine carries all three out and says so three times. Every one of
    // them is the desktop's own move, including the middle one it passed
    // through on the way back.
    const { rerender, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    for (const to of [RIGHT, LEFT, RIGHT]) {
      act(() => {
        result.current.keyed();
      });
      rerender(desktopOf(to, BOTH));
    }

    expect(warps).toStrictEqual([
      [600, 350],
      [200, 350],
      [600, 350],
    ]);
    expect(result.current.pointing([600, 350])).toBe(false);
    expect(result.current.pointing([200, 350])).toBe(false);
    expect(result.current.pointing([600, 350])).toBe(false);
  });

  it("cannot tell a landing it never heard of from a hand, and says so", () => {
    // The same three presses with the engine coalescing them into the last,
    // which is the ordering this cannot tell from the one above: the places
    // asked for before it are left listed, and a crossing at one of them
    // reads as the desktop's own rather than as the user's.
    //
    // Which is the cheaper half of an ambiguity that has no free answer. A
    // place left listed is the middle of a window, and a middle is where the
    // desktop puts a cursor rather than where a pointer crosses one — a
    // crossing lands on the edge it came in by. The reverse mistake is the
    // desktop reading its own cursor landing as the user, which is a
    // keyboard handed to a window nobody reached for and a `focus parent`
    // selection undone with it.
    const { rerender, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    for (const to of [RIGHT, LEFT, RIGHT]) {
      act(() => {
        result.current.keyed();
      });
      rerender(desktopOf(to, BOTH));
    }

    // Only the place it ended at is reported.
    pointerAt(600, 350);

    expect(result.current.pointing([200, 350])).toBe(false);
  });

  it("reads a landing as where the cursor got to", () => {
    // The place a warp is answered at is the place the cursor is now, and
    // the next press is measured against it: a window the cursor is already
    // inside is one there is nothing to move it to.
    const { rerender, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    act(() => {
      result.current.keyed();
    });
    rerender(desktopOf(RIGHT, BOTH));
    pointerAt(600, 350);
    warps = [];

    act(() => {
      result.current.keyed();
    });
    rerender(
      desktopOf({ box: RIGHT.box, id: "firefox" }, [...BOTH, "firefox"]),
    );

    expect(warps).toStrictEqual([]);
  });

  it("forgets the oldest place once too many go unanswered", () => {
    // What the cap costs, which is worth pinning rather than only writing
    // down: a place given up on is one the cursor arriving there is read as
    // the hand at, and that answer takes the rest of the list with it.
    const strips = [0, 1, 2, 3, 4].map((at) => ({
      box: { height: 100, width: 100, x: at * 200, y: 0 },
      id: `strip${at.toString()}`,
    }));
    const all = [...strips.map(({ id }) => id), LEFT.id];
    // Started somewhere else, so that all five of them are moves.
    const { rerender, result } = warping(desktopOf(LEFT, all));
    pointerAt(1500, 900);

    for (const strip of strips) {
      act(() => {
        result.current.keyed();
      });
      rerender(desktopOf(strip, all));
    }

    expect(warps).toHaveLength(5);
    // The first of the five is not one of the four kept, so the cursor
    // arriving there reads as the hand — and that answer takes the four
    // still outstanding down with it, which the second line is what says.
    expect(result.current.pointing(warpNumber(0))).toBe(true);
    expect(result.current.pointing(warpNumber(1))).toBe(true);
  });

  it("takes the pointer with the keyboard when a window closes", () => {
    // The third focus change the desktop makes for itself, beside a press
    // and a window opening: the window the keyboard was in is gone, the
    // tiling closes over it, and the keyboard lands somewhere the pointer is
    // not — with a window sliding under the pointer as it goes.
    const { rerender } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    rerender(desktopOf(RIGHT, [RIGHT.id]));

    expect(warps).toStrictEqual([[600, 350]]);
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
      result.current.keyed();
    });
    rerender(desktopOf(RIGHT, all));
    act(() => {
      result.current.keyed();
    });
    rerender(desktopOf({ box: RIGHT.box, id: "firefox" }, all));

    expect(warps).toStrictEqual([[600, 350]]);
  });
});
