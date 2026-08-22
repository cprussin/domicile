import { describe, expect, it } from "bun:test";

import type { DisplayInfo } from "@domicile/chrome-sdk/protocol";

import { asDesktopReport } from "./desktop-line";

const LEFT: DisplayInfo = {
  name: "left",
  position: [0, 0],
  scale: 1,
  size: [1920, 1080],
};

const RIGHT: DisplayInfo = {
  name: "right",
  position: [1920, 120],
  scale: 2,
  size: [2560, 1440],
};

describe("asDesktopReport", () => {
  it("carries every field a <Screen> lays out against", () => {
    // Two e2e scripts compare their output against this format literally, so
    // a change here does fail — at the cost of a compositor-shaped verdict for
    // a formatting change, in a group that needs a compositor to run at all.
    // Pinned here so it fails in the one place that is about the format.
    // Asymmetric on both axes, so a transposed pair cannot pass.
    expect(asDesktopReport([LEFT, RIGHT])).toBe(
      "left@0,0+1920x1080@1 right@1920,120+2560x1440@2",
    );
  });

  it("keeps a desktop of no screens apart from never having been told", () => {
    // The reason this function exists. Both are empty lines otherwise, and a
    // script testing `[ -z ]` would report the first as its own harness
    // failing — a delivery bug's verdict for a compositor that answered.
    expect(asDesktopReport(undefined)).toBe("(never told)");
    expect(asDesktopReport([])).toBe("(none)");
    expect(asDesktopReport([])).not.toBe(asDesktopReport(undefined));
  });
});
