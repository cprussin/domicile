import { describe, expect, it } from "bun:test";

import { claimShortcut, isClaimed } from "./shortcut-claims";

/** The evdev code for Enter. */
const ENTER = 28;

describe("shortcut claims", () => {
  it("holds a press the shell claimed", () => {
    claimShortcut({ altKey: true, keycode: ENTER });

    expect(
      isClaimed({
        altKey: true,
        ctrlKey: false,
        keycode: ENTER,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(true);
  });

  it("does not hold a press carrying a modifier the claim leaves out", () => {
    // An omitted modifier must not be held, matching the engine.
    claimShortcut({ altKey: true, keycode: ENTER });

    expect(
      isClaimed({
        altKey: true,
        ctrlKey: true,
        keycode: ENTER,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe(false);
  });
});
