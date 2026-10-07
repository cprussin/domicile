import { describe, expect, it } from "bun:test";

import { BarClock, BarSharing } from "./bar-items";
import { DEFAULT_TOP_BAR } from "./layout";
import { showsSharing } from "./shows-sharing";

describe("showsSharing", () => {
  it("is true for a bar with the sharing item in any column", () => {
    expect(showsSharing(DEFAULT_TOP_BAR)).toBe(true);
    expect(
      showsSharing({ left: [], middle: [<BarSharing key="s" />], right: [] }),
    ).toBe(true);
  });

  it("is false for a bar without it", () => {
    expect(
      showsSharing({
        left: ["text"],
        middle: [<BarClock key="c" />],
        right: [],
      }),
    ).toBe(false);
  });
});
