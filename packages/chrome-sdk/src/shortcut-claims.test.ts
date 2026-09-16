import { describe, expect, it } from "bun:test";

import { claimShortcut, isClaimed } from "./shortcut-claims";

/** Enter, in the evdev numbering a claim and a press are both written in. */
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
    // An omitted modifier is one that must *not* be held, the same reading the
    // engine's dictionary gives it: Ctrl+Alt+Enter is a combination nobody
    // claimed, and the window is entitled to it.
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
