import { describe, expect, it } from "bun:test";

import { Clock } from "@domicile-desktop/manganese-bar-module-clock";
import { Sharing } from "@domicile-desktop/manganese-bar-module-sharing";
import { DEFAULT_BAR } from "./default-bars";
import { showsSharing } from "./shows-sharing";

describe("showsSharing", () => {
  it("is true for a bar with the sharing item in any column", () => {
    expect(showsSharing(DEFAULT_BAR)).toBe(true);
    expect(
      showsSharing({ center: [<Sharing key="s" />], left: [], right: [] }),
    ).toBe(true);
  });

  it("is false for a bar without it", () => {
    expect(
      showsSharing({
        center: [<Clock key="c" />],
        left: ["text"],
        right: [],
      }),
    ).toBe(false);
  });
});
