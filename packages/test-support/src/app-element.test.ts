import { describe, expect, it } from "bun:test";

describe("registerAppElement", () => {
  it("makes an `<app>` a known element rather than an unknown one", () => {
    expect(document.createElement("app")).not.toBeInstanceOf(
      HTMLUnknownElement,
    );
  });
});
