import { describe, expect, it } from "bun:test";
import type { Display } from "@domicile/component-library/display-source";

import { desktopSize } from "./desktop-size";

const display = (
  name: string,
  position: readonly [number, number],
  size: readonly [number, number],
): Display => ({ name, position, scale: 1, size });

describe("desktopSize", () => {
  it("is the one display, when there is one", () => {
    expect(desktopSize([display("only", [0, 0], [1920, 1080])])).toStrictEqual([
      1920, 1080,
    ]);
  });

  it("reaches the far edge of the display furthest out, not the first one", () => {
    // The list is the config's order, which is not an order at all: the
    // rightmost display is wherever the user wrote it.
    expect(
      desktopSize([
        display("right", [1920, 0], [1280, 1024]),
        display("left", [0, 0], [1920, 1080]),
      ]),
    ).toStrictEqual([3200, 1080]);
  });

  it("counts a gap between two displays", () => {
    // The page spans the hole. #74 rejects overlap and not a gap, because real
    // desktops have them — and a desktop measured as the widths added up would
    // put every screen past the gap off the end of the window.
    expect(
      desktopSize([
        display("left", [0, 0], [1920, 1080]),
        display("right", [2560, 0], [1920, 1080]),
      ]),
    ).toStrictEqual([4480, 1080]);
  });

  it("grows downwards for a display stacked below another", () => {
    // Two dimensions, so this is a bounding box rather than a row.
    expect(
      desktopSize([
        display("top", [0, 0], [1920, 1080]),
        display("under", [0, 1080], [1920, 1200]),
      ]),
    ).toStrictEqual([1920, 2280]);
  });

  it("is nothing at all for a desktop of no screens", () => {
    // Arithmetic over a list, and a list can be empty. `Math.max` of nothing
    // is `-Infinity`, which reaches the host as a window size.
    expect(desktopSize([])).toStrictEqual([0, 0]);
  });
});
