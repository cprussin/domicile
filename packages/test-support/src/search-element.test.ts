import { describe, expect, it } from "bun:test";

describe("registerSearchElement", () => {
  it("makes a `<search>` a known element rather than an unknown one", () => {
    expect(document.createElement("search")).not.toBeInstanceOf(
      HTMLUnknownElement,
    );
  });
});
