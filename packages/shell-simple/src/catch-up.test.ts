import { describe, expect, it } from "bun:test";

import type { CatchUpBridge, CatchUpDesktop } from "./catch-up";
import { endCatchUpOnFocusChange } from "./catch-up";

/** A bridge that hands back whatever the shell listened with. */
const fakeBridge = () => {
  let heard: (() => void) | undefined;
  const bridge: CatchUpBridge = {
    on: (_type, listener) => {
      heard = listener;
    },
  };
  return {
    bridge,
    /** The host saying who holds the keyboard, which ends the replay. */
    focusChanged: () => {
      if (heard === undefined) {
        throw new Error("test: nothing listened for the focus change");
      } else {
        heard();
      }
    },
  };
};

const fakeDesktop = () => {
  const told: true[] = [];
  const desktop: CatchUpDesktop = {
    caughtUp: () => {
      told.push(true);
    },
  };
  return { desktop, told };
};

describe("endCatchUpOnFocusChange", () => {
  it("tells the desktop the catch-up is over when the host says who has the keyboard", () => {
    const { bridge, focusChanged } = fakeBridge();
    const { desktop, told } = fakeDesktop();
    endCatchUpOnFocusChange(bridge, desktop);
    focusChanged();
    expect(told).toStrictEqual([true]);
  });

  it("says nothing until the host does", () => {
    // The replayed windows arrive first, and a desktop told too early would
    // focus them — which is the whole reason this exists.
    const { bridge } = fakeBridge();
    const { desktop, told } = fakeDesktop();
    endCatchUpOnFocusChange(bridge, desktop);
    expect(told).toStrictEqual([]);
  });
});
