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

  // A stow is a drop the other way, played forwards so it starts on the
  // spring from rest rather than in its tail.
  it.each([
    ["windowStowing", "windowDropping"],
    ["backdropHiding", "backdropShowing"],
  ] as const)("plays %s on the frames of %s mirrored", (mirrored, frames) => {
    expect(keyframes[mirrored]).toStrictEqual(
      Object.fromEntries(
        Object.entries(keyframes[frames] ?? {})
          .map(([offset, frame]) => [
            `${100 - Number.parseFloat(offset)}%`,
            frame,
          ])
          .toReversed(),
      ),
    );
  });

  // With the slide blur on, each slide blurs most as it moves fastest,
  // early on its spring, and lands sharp.
  it.each([
    ["windowArrivingFromEndBlurred", "windowArrivingFromEnd"],
    ["windowArrivingFromStartBlurred", "windowArrivingFromStart"],
    ["windowLeavingToEndBlurred", "windowLeavingToEnd"],
    ["windowLeavingToStartBlurred", "windowLeavingToStart"],
  ] as const)("blurs %s along the frames of %s", (blurred, slide) => {
    expect(keyframes[blurred]).toStrictEqual({
      "0%": {
        ...keyframes[slide]?.["0%"],
        filter: "domicile-shader(slide-blur, 0, var(--device-pixel-ratio))",
      },
      "20%": {
        filter: "domicile-shader(slide-blur, 12, var(--device-pixel-ratio))",
      },
      "100%": {
        ...keyframes[slide]?.["100%"],
        filter: "domicile-shader(slide-blur, 0, var(--device-pixel-ratio))",
      },
    });
  });

  // A short fade and a slight shrink: closing is quiet.
  it("fades a closing window out as it shrinks a little", () => {
    expect(keyframes.windowClosing).toStrictEqual({
      "0%": { opacity: "1", transform: "scale(1)" },
      "100%": { opacity: "0", transform: "scale(0.95)" },
    });
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

  // `--travel-x`, `--travel-y` and `--travel-scale` are set by `traveled`.
  it("opens a window from the window that opened it", () => {
    expect(keyframes.windowOpening).toStrictEqual({
      "0%": {
        opacity: "0",
        transform:
          "translate(var(--travel-x, 0px), var(--travel-y, 0px)) scale(var(--travel-scale, 0.85))",
      },
      "100%": { opacity: "1", transform: "none" },
    });
  });

  it("sends a window off into its workspace's chip", () => {
    expect(keyframes.windowSending).toStrictEqual({
      "0%": { opacity: "1", transform: "none" },
      "100%": {
        opacity: "0",
        transform:
          "translate(var(--travel-x, 0px), var(--travel-y, 0px)) scale(var(--travel-scale, 0.6))",
      },
    });
  });
});
