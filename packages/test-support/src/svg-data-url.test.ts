import { describe, expect, it } from "bun:test";

import square from "./fixtures/square.svg";

describe("registerSvgDataUrl", () => {
  it("imports an SVG as a data URL, as Vite inlines one", () => {
    expect(square).toStartWith("data:image/svg+xml");
  });
});
