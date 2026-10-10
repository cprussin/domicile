import { describe, expect, it } from "bun:test";

import config from "./panda.config";

const keyframes = config.theme?.extend?.keyframes;
if (keyframes === undefined) {
  throw new Error("shell: panda.config.ts defines no keyframes");
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
});
