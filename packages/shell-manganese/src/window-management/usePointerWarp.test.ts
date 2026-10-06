import { beforeEach, describe, expect, it } from "bun:test";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { act, fireEvent, renderHook } from "@testing-library/react";

import type { Focus, Spot } from "./pointer-warp";
import { usePointerWarp } from "./usePointerWarp";

const LEFT = {
  box: { height: 500, width: 400, x: 0, y: 100 },
  id: "kitty",
} satisfies Focus;
const RIGHT = {
  box: { height: 500, width: 400, x: 400, y: 100 },
  id: "emacs",
} satisfies Focus;

let warps: Spot[] = [];

/** The part of the host client this hook uses. */
const recordingDomicile = {
  warpPointer: (x: number, y: number) => {
    warps.push([x, y]);
  },
} as unknown as DomicileHost;

/** One render's inputs: the focused window and the open windows. */
type Desktop = {
  focus: Focus | undefined;
  windows: readonly string[];
};

/** A desktop with nothing on it, which is what the chrome always mounts on. */
const NOTHING: Desktop = { focus: undefined, windows: [] };

/**
 * The hook, mounted empty with `desktop`'s windows then opened into it.
 *
 * Mounts empty because the chrome always does, and opening a window is itself
 * something the hook reacts to. Warps from the openings are cleared before the
 * case runs.
 */
const warping = (desktop: Desktop) => {
  // The desk's key press count, shared by every monitor.
  let pressed = 0;
  const view = renderHook(
    (current: Desktop) =>
      usePointerWarp({
        domicile: recordingDomicile,
        focus: current.focus,
        pressed,
        windows: current.windows,
      }),
    { initialProps: NOTHING },
  );
  view.rerender(desktop);
  warps = [];
  return {
    ...view,
    /** A key ran a command. */
    press: () => {
      pressed += 1;
    },
  };
};

/** A desktop of `windows`, with the keyboard on `focus`. */
const desktopOf = (focus: Focus, windows: readonly string[]): Desktop => ({
  focus,
  windows,
});

/** The two windows most cases start from. */
const BOTH = [LEFT.id, RIGHT.id];

/**
 * The target of warp number `at`.
 *
 * Throws if there is none, since `[0, 0]` is a valid spot and a default would
 * hide a missing warp.
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
    const { rerender, press } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    act(() => {
      press();
    });
    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([[600, 350]]);
  });

  it("leaves it where it is when the focus moved on its own account", () => {
    // Focus moved because the pointer crossed a window (`onHover` in
    // `Desktop`). Warping here would chase the pointer.
    const { rerender } = warping(desktopOf(LEFT, BOTH));
    pointerAt(600, 350);
    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([]);
  });

  it("keeps up with the pointer, so a window it is already over moves nothing", () => {
    const { rerender, press } = warping(desktopOf(LEFT, BOTH));
    pointerAt(600, 350);

    act(() => {
      press();
    });
    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([]);
  });

  it("does not warp twice for one press", () => {
    // A press is spent on the render that answers it. Later renders, such as a
    // title change, must not warp.
    const { rerender, press } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    act(() => {
      press();
    });
    rerender(desktopOf(RIGHT, BOTH));
    rerender(desktopOf(LEFT, BOTH));

    expect(warps).toStrictEqual([[600, 350]]);
  });

  it("takes the pointer to a window that has just opened", () => {
    // A window opens and takes focus with no key press, such as a terminal
    // finishing startup. The pointer is still over the neighbor, which would
    // take focus back.
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
    // A window that opens without focus, such as on another workspace, is
    // ignored.
    const { rerender } = warping(desktopOf(LEFT, [LEFT.id]));
    pointerAt(200, 300);

    rerender(desktopOf(LEFT, BOTH));

    expect(warps).toStrictEqual([]);
  });

  it("leaves the pointer alone for a window that opens as a tab of the focused stack", () => {
    // It takes the focused window's box, so nothing moved under the pointer,
    // which may be anywhere.
    const { rerender } = warping(desktopOf(LEFT, [LEFT.id]));
    pointerAt(900, 10);

    rerender(desktopOf({ box: LEFT.box, id: "firefox" }, [LEFT.id, "firefox"]));

    expect(warps).toStrictEqual([]);
  });

  it("takes the pointer to a window that opens as a tab of a stack it was not in", () => {
    const { rerender } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    rerender(
      desktopOf({ box: RIGHT.box, id: "firefox" }, [...BOTH, "firefox"]),
    );

    expect(warps).toStrictEqual([[600, 350]]);
  });

  it("reads a window arriving where the pointer already is as no pointing", () => {
    // Layout moving under a still pointer fires `pointerover` like a real
    // crossing. The position tells them apart: a window arriving under the
    // pointer arrives at the pointer's spot.
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
    // The engine does not report when a warp lands, so the cursor may be at its
    // old spot or the target. A window arriving at either came to the pointer.
    const { rerender, press, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    act(() => {
      press();
    });
    rerender(desktopOf(RIGHT, BOTH));

    expect(result.current.pointing([200, 300])).toBe(false);
  });

  it("counts where it put the pointer itself as where the pointer is", () => {
    // The landing is not a user choice. The first window it lands on may not be
    // the target, since boxes are still animating.
    const { rerender, press, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    act(() => {
      press();
    });
    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([[600, 350]]);
    expect(result.current.pointing([600, 350])).toBe(false);
  });

  it("counts a landing the engine rounded as where it put the pointer", () => {
    // At a fractional scale the engine floors the warp into device pixels and
    // again into DIPs, so the landing reaches the page up to 1.5 pixels short
    // of the target.
    const { rerender, press, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    act(() => {
      press();
    });
    rerender(desktopOf(RIGHT, BOTH));

    expect(result.current.pointing([598.5, 351.5])).toBe(false);
  });

  it("still reads two pixels from the pointer as the hand", () => {
    const { result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    expect(result.current.pointing([202, 300])).toBe(true);
  });

  it("answers for a pointer it has never seen at all", () => {
    // The pointer's position is unknown at first. Guessing it would swallow the
    // user's first crossing.
    const { result } = warping(desktopOf(LEFT, BOTH));

    expect(result.current.pointing([200, 300])).toBe(true);
  });

  it("remembers every place it has asked for that nothing has reached yet", () => {
    // Two presses before the first warp lands produce two landings, both from
    // the desktop. A single slot would forget the first and misread its
    // landing.
    const { rerender, press, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    act(() => {
      press();
    });
    rerender(desktopOf(RIGHT, BOTH));
    act(() => {
      press();
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
    // Warps run in order, so a landing at the second means the first will never
    // report: the engine coalesces moves within a frame. Keeping the first
    // would measure the next press from the wrong place and leave the pointer
    // behind.
    const { rerender, press, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    act(() => {
      press();
    });
    rerender(desktopOf(RIGHT, BOTH));
    act(() => {
      press();
    });
    rerender(desktopOf(LEFT, BOTH));
    warps = [];

    // Only the second landing is reported.
    pointerAt(200, 350);
    act(() => {
      press();
    });
    rerender(desktopOf(RIGHT, BOTH));

    expect(warps).toStrictEqual([[600, 350]]);
    expect(result.current.pointing([600, 350])).toBe(false);
  });

  it("answers every landing when the engine reports each of them", () => {
    // Three presses, the third back at the first target, each reported by the
    // engine. All three landings are the desktop's.
    const { rerender, press, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    for (const to of [RIGHT, LEFT, RIGHT]) {
      act(() => {
        press();
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
    // The same presses, coalesced by the engine into the last. This is
    // indistinguishable from the case above, so the earlier targets stay listed
    // and a crossing at one reads as a warp. See `Pointer.pointing` for why
    // this side of the ambiguity was chosen.
    const { rerender, press, result } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    for (const to of [RIGHT, LEFT, RIGHT]) {
      act(() => {
        press();
      });
      rerender(desktopOf(to, BOTH));
    }

    // Only the final landing is reported.
    pointerAt(600, 350);

    expect(result.current.pointing([200, 350])).toBe(false);
  });

  it("reads a landing as where the cursor got to", () => {
    // A landing updates the pointer position, so the next press needs no warp
    // when the cursor is already inside the target.
    const { rerender, press } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);
    act(() => {
      press();
    });
    rerender(desktopOf(RIGHT, BOTH));
    pointerAt(600, 350);
    warps = [];

    act(() => {
      press();
    });
    rerender(
      desktopOf({ box: RIGHT.box, id: "firefox" }, [...BOTH, "firefox"]),
    );

    expect(warps).toStrictEqual([]);
  });

  it("forgets the oldest place once too many go unanswered", () => {
    // Pins the cost of `IN_FLIGHT`: a landing at a dropped target reads as a
    // user move, which clears the remaining targets.
    const strips = [0, 1, 2, 3, 4].map((at) => ({
      box: { height: 100, width: 100, x: at * 200, y: 0 },
      id: `strip${at.toString()}`,
    }));
    const all = [...strips.map(({ id }) => id), LEFT.id];
    // Start elsewhere so all five presses warp.
    const { rerender, press, result } = warping(desktopOf(LEFT, all));
    pointerAt(1500, 900);

    for (const strip of strips) {
      act(() => {
        press();
      });
      rerender(desktopOf(strip, all));
    }

    expect(warps).toHaveLength(5);
    // The first target was dropped, so its landing reads as the user and clears
    // the other four.
    expect(result.current.pointing(warpNumber(0))).toBe(true);
    expect(result.current.pointing(warpNumber(1))).toBe(true);
  });

  it("takes the pointer with the keyboard when a window closes", () => {
    // Closing the focused window moves focus elsewhere while the tiling slides
    // a window under the pointer.
    const { rerender } = warping(desktopOf(LEFT, BOTH));
    pointerAt(200, 300);

    rerender(desktopOf(RIGHT, [RIGHT.id]));

    expect(warps).toStrictEqual([[600, 350]]);
  });

  it("leaves the pointer alone when a tab closes onto the next one", () => {
    // The next tab takes the closed tab's box, so nothing moved under the
    // pointer, which is on the tab bar's close button.
    const { rerender } = warping(desktopOf(LEFT, [...BOTH, "firefox"]));
    pointerAt(200, 90);

    rerender(
      desktopOf({ box: LEFT.box, id: "firefox" }, [RIGHT.id, "firefox"]),
    );

    expect(warps).toStrictEqual([]);
  });

  it("remembers where it put the pointer", () => {
    // The engine does not report warps, so the hook records its own targets.
    // Otherwise the next press would be measured from a stale position.
    const all = [...BOTH, "firefox"];
    const { rerender, press } = warping(desktopOf(LEFT, all));
    pointerAt(200, 300);

    act(() => {
      press();
    });
    rerender(desktopOf(RIGHT, all));
    act(() => {
      press();
    });
    rerender(desktopOf({ box: RIGHT.box, id: "firefox" }, all));

    expect(warps).toStrictEqual([[600, 350]]);
  });

  describe("a screen with nothing on it", () => {
    /** A screen with no windows, where the screen itself is the focus. */
    const EMPTY: Focus = {
      box: { height: 600, width: 800, x: 0, y: 0 },
      id: undefined,
    };

    it("takes the pointer to its middle when a key brings the keyboard", () => {
      const { press, rerender } = warping({ focus: undefined, windows: BOTH });

      act(() => {
        press();
      });
      rerender({ focus: EMPTY, windows: BOTH });

      expect(warps).toStrictEqual([[400, 300]]);
    });
  });
});
