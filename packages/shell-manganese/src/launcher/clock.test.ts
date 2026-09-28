import { describe, expect, it } from "bun:test";

import { clockOf } from "./clock";

describe("clockOf", () => {
  it("reads a length the way a player's clock does", () => {
    expect(clockOf(0)).toBe("0:00");
    expect(clockOf(61.5)).toBe("1:01");
    expect(clockOf(3600 + 62)).toBe("1:01:02");
  });
});
