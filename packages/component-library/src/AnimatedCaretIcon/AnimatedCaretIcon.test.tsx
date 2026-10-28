import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedCaretIcon } from "./AnimatedCaretIcon";

describe(AnimatedCaretIcon, () => {
  it.each([
    ["left", "-1", "0"],
    ["right", "1", "0"],
    ["up", "0", "-1"],
    ["down", "0", "1"],
  ] as const)("darts %s", (pointing, x, y) => {
    const { container } = render(
      <AnimatedCaretIcon pointing={pointing} size={16} />,
    );
    const dart = container.querySelector<SVGGElement>("svg > g");
    expect(dart?.style.getPropertyValue("--part-x")).toBe(x);
    expect(dart?.style.getPropertyValue("--part-y")).toBe(y);
  });

  it("turns its arms about their tip", () => {
    const { container } = render(
      <AnimatedCaretIcon pointing="left" size={16} />,
    );
    for (const arm of container.querySelectorAll<SVGGElement>(
      "[data-part=arm]",
    )) {
      expect(arm.style.getPropertyValue("--part-origin")).toBe("80px 128px");
    }
  });
});
