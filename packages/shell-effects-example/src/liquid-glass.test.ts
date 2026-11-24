import { describe, expect, it } from "bun:test";

import { glassFilter } from "./liquid-glass";

describe("glassFilter", () => {
  it("frosts the backdrop, then bends it at the page's scale", () => {
    expect(glassFilter(2)).toBe(
      "blur(6px) domicile-shader(liquid-glass, 18, 22, 24, 1, 2)",
    );
  });
});
