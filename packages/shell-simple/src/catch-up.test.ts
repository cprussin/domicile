import { describe, expect, it } from "bun:test";

import type { CatchUpDesktop, CatchUpDomicile } from "./catch-up";
import { endCatchUpOnFocusChange } from "./catch-up";

/** A domicile client that hands back whatever the shell listened with. */
const fakeDomicile = () => {
  let heard: (() => void) | undefined;
  const domicile: CatchUpDomicile = {
    on: (_type, listener) => {
      heard = listener;
    },
  };
  return {
    domicile,
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
    const { domicile, focusChanged } = fakeDomicile();
    const { desktop, told } = fakeDesktop();
    endCatchUpOnFocusChange(domicile, desktop);
    focusChanged();
    expect(told).toStrictEqual([true]);
  });

  it("says nothing until the host does", () => {
    // The replayed windows arrive first, and a desktop told too early would
    // focus them — which is the whole reason this exists.
    const { domicile } = fakeDomicile();
    const { desktop, told } = fakeDesktop();
    endCatchUpOnFocusChange(domicile, desktop);
    expect(told).toStrictEqual([]);
  });
});
