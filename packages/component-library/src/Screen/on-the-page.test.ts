import { describe, expect, it } from "bun:test";

import type { Display } from "./display-source";
import { onThePage } from "./on-the-page";

/** The desk this exists for: a 4K panel at 1.2, stood on its side. */
const MODE = [3840, 2160] as const;

/** That panel's logical box, which is what a region is laid out at. */
const UPRIGHT = [1800, 3200] as const;

/** And the same panel lying down, for the half that is only density. */
const LYING_DOWN = [3200, 1800] as const;

const panel = (
  size: readonly [number, number],
  scanout: Display["scanout"],
  position: readonly [number, number] = [0, 0],
): Display => ({ name: "panel", position, scale: 1.2, scanout, size });

describe("onThePage", () => {
  it("answers with the spot it was given for a region that is not a window", () => {
    // Every desktop the page's window is the whole of: a nested run, a
    // developer window, a shell open in a plain browser. The region carries no
    // transform there, so the desktop's logical pixels already ARE the page's
    // and a mapping would be a lie about what was drawn.
    expect(onThePage(panel(LYING_DOWN, undefined), [100, 200])).toStrictEqual([
      100, 200,
    ]);
  });

  it("scales a spot onto a window of more pixels than the region lays out in", () => {
    // 3840 over 3200 is 1.2, so a spot 100 logical pixels along is 120 of the
    // window's — which is where the pointer has to be put to land on it.
    expect(
      onThePage(
        panel(LYING_DOWN, { size: MODE, transform: "normal" }),
        [100, 200],
      ),
    ).toStrictEqual([120, 240]);
  });

  it("turns a spot counterclockwise with the region it is in", () => {
    // This desk. The region's top-left corner is drawn at the window's
    // BOTTOM-left, so a spot's logical x runs up the window and its y runs
    // across it — scaled first, exactly as the CSS applies it.
    expect(
      onThePage(
        panel(UPRIGHT, { size: MODE, transform: "rotate-270" }),
        [100, 200],
      ),
    ).toStrictEqual([240, 2040]);
  });

  it("turns a spot clockwise with the region it is in", () => {
    expect(
      onThePage(
        panel(UPRIGHT, { size: MODE, transform: "rotate-90" }),
        [100, 200],
      ),
    ).toStrictEqual([3600, 120]);
  });

  it("turns a spot over with the region it is in", () => {
    expect(
      onThePage(
        panel(LYING_DOWN, { size: MODE, transform: "rotate-180" }),
        [100, 200],
      ),
    ).toStrictEqual([3720, 1920]);
  });

  it("puts the region's own corner on the window's", () => {
    // The anchor the three turns are read against: `transform-origin` is the
    // region's top-left, so wherever that corner lands is where the turn put
    // it — the bottom-left of the window for a counterclockwise quarter.
    expect(
      onThePage(
        panel(UPRIGHT, { size: MODE, transform: "rotate-270" }),
        [0, 0],
      ),
    ).toStrictEqual([0, 2160]);
  });

  it("measures the turn from the region's corner and not the page's", () => {
    // A region is placed at its display's position and turned about its own
    // corner, so a desktop whose screens do not start at the origin maps
    // through the position twice over: out of the desktop's coordinates, and
    // back into the page's.
    expect(
      onThePage(
        panel(LYING_DOWN, { size: MODE, transform: "normal" }, [1000, 500]),
        [1100, 700],
      ),
    ).toStrictEqual([1120, 740]);
  });

  it("answers with the spot it was given for a window of no pixels", () => {
    // `coverTheWindow` draws no transform for a display either side of which
    // has no extent, so nothing is mapped and this says the same. Neither is
    // reachable — a zero-sized display is refused by the config and by the
    // page's schema — and the two agreeing is what matters if one ever is.
    expect(
      onThePage(
        panel(LYING_DOWN, { size: [0, 0], transform: "normal" }),
        [100, 200],
      ),
    ).toStrictEqual([100, 200]);
  });
});
