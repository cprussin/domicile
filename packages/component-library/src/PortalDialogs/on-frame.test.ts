import { describe, expect, it } from "bun:test";
import type { FrozenDesk } from "@domicile-desktop/sdk/portal";
import { onDesk } from "./on-frame";

/** A 300x100 frame of the desktop from (-10, 0) to (140, 50). */
const DESK: FrozenDesk = {
  desk: { position: [-10, 0], size: [150, 50] },
  frame: "",
  height: 100,
  monitors: [],
  width: 300,
  windows: [],
};

describe(onDesk, () => {
  it("finds an area of the frame on the desktop, in its logical pixels", () => {
    expect(onDesk(DESK, { height: 30, width: 80, x: 20, y: 20 })).toEqual({
      position: [0, 10],
      size: [40, 15],
    });
  });

  it("covers every pixel a part-pixel area touches", () => {
    expect(onDesk(DESK, { height: 31, width: 81, x: 21, y: 20 })).toEqual({
      position: [0, 10],
      size: [41, 16],
    });
  });
});
