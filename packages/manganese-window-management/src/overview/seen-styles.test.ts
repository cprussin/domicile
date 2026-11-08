import { describe, expect, it } from "bun:test";

import { seenAt, seenStyles } from "./seen-styles";

const SCREEN = { height: 1080, width: 1920, x: 1920, y: 0 };
const SEEN = {
  fading: false,
  showing: false,
  view: { scale: 0.25, x: 100, y: 50 },
};

describe("seenAt", () => {
  it("leaves a window alone outside the overview", () => {
    expect(seenAt(undefined, SCREEN, 3)).toStrictEqual({});
  });

  it("shrinks it into its tile, stacked at its own depth", () => {
    expect(seenAt(SEEN, SCREEN, 3)).toMatchObject({
      transform: "matrix(0.25, 0, 0, 0.25, 100, 50)",
      zIndex: 3,
    });
  });

  it("clips it to its screen, so it shows only in its tile", () => {
    expect(seenAt(SEEN, SCREEN, 0).clip).toBe(
      "rect(0px, 3840px, 1080px, 1920px)",
    );
  });

  it("fades it while the overview closes", () => {
    expect(seenAt(SEEN, SCREEN, 0).opacity).toBe(1);
    expect(seenAt({ ...SEEN, fading: true }, SCREEN, 0).opacity).toBe(0);
  });

  it("lets presses through a window fading out, even its tab strip's buttons", () => {
    // Once the overview's picker is gone, a press on a hidden workspace's
    // window as it fades must not go to that workspace. The strips set their
    // own `pointer-events`, so the rule reaches every part, not only the
    // wrapper.
    expect(seenStyles.raw({ fading: false })).not.toHaveProperty("& *");
    expect(seenStyles.raw({ fading: true })).toMatchObject({
      "& *": { pointerEvents: "none!" },
      pointerEvents: "none",
    });
  });
});
