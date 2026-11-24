import { describe, expect, it } from "bun:test";

import { chipFor, traveled, travelTo, WORKSPACE_CHIP } from "./travel";

const FRAME = { height: 600, width: 800, x: 100, y: 100 };

describe("travelTo", () => {
  it("moves the frame's middle onto the target's", () => {
    expect(
      travelTo(FRAME, { height: 200, width: 200, x: 0, y: 700 }, false),
    ).toStrictEqual({ scale: undefined, x: -400, y: 400 });
  });

  // A window sent away fits into its workspace's chip.
  it("shrinks the frame to fit inside a target it is sized to", () => {
    expect(
      travelTo(FRAME, { height: 24, width: 32, x: 10, y: 4 }, true),
    ).toStrictEqual({ scale: 0.04, x: -474, y: -384 });
  });
});

describe("traveled", () => {
  it("sets nothing for a window going nowhere", () => {
    expect(traveled(undefined)).toStrictEqual({});
  });

  it("sets how far the window travels", () => {
    expect(traveled({ scale: undefined, x: -400, y: 400 })).toStrictEqual({
      "--travel-x": "-400px",
      "--travel-y": "400px",
    });
  });

  it("sets how small it travels to, if it is sized to its target", () => {
    expect(traveled({ scale: 0.04, x: 3, y: 4 })).toStrictEqual({
      "--travel-scale": 0.04,
      "--travel-x": "3px",
      "--travel-y": "4px",
    });
  });
});

describe("chipFor", () => {
  it("finds the workspace's chip in the bar", () => {
    const chip = document.createElement("button");
    chip.setAttribute(WORKSPACE_CHIP, "2");
    document.body.append(chip);

    expect(chipFor("2")).toBe(chip);
    chip.remove();
  });

  it("finds none for a workspace no bar shows", () => {
    expect(chipFor("9")).toBeUndefined();
  });

  it("reads a workspace named anything", () => {
    const chip = document.createElement("button");
    chip.setAttribute(WORKSPACE_CHIP, 'mail "work"');
    document.body.append(chip);

    expect(chipFor('mail "work"')).toBe(chip);
    chip.remove();
  });
});
