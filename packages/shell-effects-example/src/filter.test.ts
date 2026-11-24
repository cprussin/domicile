import { describe, expect, it } from "bun:test";

import { domicileShader } from "./filter";

describe("domicileShader", () => {
  it("names the effect, then its arguments in order", () => {
    expect(domicileShader("liquid-glass", 24, 0.5, -1)).toBe(
      "domicile-shader(liquid-glass, 24, 0.5, -1)",
    );
  });

  it("is the name alone for an effect that takes nothing", () => {
    expect(domicileShader("smoke")).toBe("domicile-shader(smoke)");
  });
});
