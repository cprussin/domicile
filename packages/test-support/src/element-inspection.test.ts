import { describe, expect, it } from "bun:test";

describe("registerElementInspection", () => {
  it("inspects an element as its own markup", () => {
    const element = document.createElement("p");
    element.className = "greeting";
    element.append("Hello");
    document.body.append(element);

    expect(Bun.inspect(element)).toBe(`<p class="greeting">Hello</p>`);
  });
});
