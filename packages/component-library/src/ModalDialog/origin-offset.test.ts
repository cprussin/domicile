import { describe, expect, it } from "bun:test";

import { originOffset } from "./origin-offset";

describe(originOffset, () => {
  it("is how far the origin's middle is from the popup's", () => {
    // The popup's middle is (500, 300); the origin's is (110, 20).
    expect(
      originOffset(
        { height: 200, left: 300, top: 200, width: 400 },
        { height: 24, left: 100, top: 8, width: 20 },
      ),
    ).toStrictEqual({ x: -390, y: -280 });
  });
});
