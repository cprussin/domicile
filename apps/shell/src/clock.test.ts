import { describe, expect, it } from "bun:test";

import { installClock } from "./clock";

describe("installClock", () => {
  it("renders the current time immediately", () => {
    const element = document.createElement("span");
    const fixed = new Date("2024-01-02T03:04:05Z");

    const stop = installClock(element, () => fixed);
    stop();

    expect(element.textContent).toBe(fixed.toLocaleTimeString());
  });
});
