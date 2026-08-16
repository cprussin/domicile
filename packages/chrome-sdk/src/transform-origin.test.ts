import { describe, expect, it } from "bun:test";

import { parseTransformOrigin } from "./transform-origin";

describe("parseTransformOrigin", () => {
  it("reads the computed pixel pair", () => {
    expect(parseTransformOrigin("50px 25px")).toEqual([50, 25]);
  });

  it("ignores the z component of a 3D origin", () => {
    expect(parseTransformOrigin("12px 8px 0px")).toEqual([12, 8]);
  });

  it("reports nothing when the value is not computed to lengths", () => {
    expect(parseTransformOrigin("")).toBeUndefined();
    expect(parseTransformOrigin("center")).toBeUndefined();
  });
});
