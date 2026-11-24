import { describe, expect, it } from "bun:test";

import { windowManagementPreset } from "./panda-preset";

const keyframes = windowManagementPreset.theme?.extend?.keyframes;
if (keyframes === undefined) {
  throw new Error("shell: the window management preset defines no keyframes");
}

describe("window keyframes", () => {
  // Chromium runs an animation on the compositor thread only when every
  // property it animates can run there. `z-index` cannot, so mixing it in
  // would tie a window's motion to the page's main thread.
  it("never move or fade a window and change its depth in one animation", () => {
    const mixed = Object.entries(keyframes)
      .filter(([name]) => name.startsWith("window"))
      .filter(([, frames]) => {
        const properties = Object.values(frames).flatMap((frame) =>
          Object.keys(frame),
        );
        return (
          properties.includes("zIndex") &&
          (properties.includes("transform") || properties.includes("opacity"))
        );
      })
      .map(([name]) => name);

    expect(mixed).toStrictEqual([]);
  });

  // A reversed switch plays the frames of the slide it cuts short backwards,
  // under another name so the browser starts it anew.
  it.each([
    ["windowRetreatingToEnd", "windowArrivingFromEnd"],
    ["windowRetreatingToStart", "windowArrivingFromStart"],
    ["windowReturningFromEnd", "windowLeavingToEnd"],
    ["windowReturningFromStart", "windowLeavingToStart"],
  ] as const)("plays %s on the frames of %s", (reversal, slide) => {
    expect(keyframes[reversal]).toStrictEqual(keyframes[slide]);
  });

  // `--tab-slide-x` and `--tab-slide-y` are the side, set by `tabSlidFrom`.
  it("slides a revealed tab in from its side as it fades in", () => {
    expect(keyframes.windowRevealing).toStrictEqual({
      "0%": {
        opacity: "0",
        transform:
          "translate(calc(var(--tab-slide-x, 0) * {spacing.6}), calc(var(--tab-slide-y, 0) * {spacing.6}))",
      },
      "100%": { opacity: "1", transform: "none" },
    });
  });
});
