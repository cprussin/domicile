import { describe, expect, it } from "bun:test";

import { BarClock, BarSharing } from "./bar-items";
import { DEFAULT_BAR } from "./layout";
import { showsSharing } from "./shows-sharing";

describe("showsSharing", () => {
  it("is true for a bar with the sharing item in any column", () => {
    expect(showsSharing(DEFAULT_BAR)).toBe(true);
    expect(
      showsSharing({ center: [<BarSharing key="s" />], left: [], right: [] }),
    ).toBe(true);
  });

  it("is false for a bar without it", () => {
    expect(
      showsSharing({
        center: [<BarClock key="c" />],
        left: ["text"],
        right: [],
      }),
    ).toBe(false);
  });
});
