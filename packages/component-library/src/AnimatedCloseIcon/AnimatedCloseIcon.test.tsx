import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { AnimatedCloseIcon } from "./AnimatedCloseIcon";

describe(AnimatedCloseIcon, () => {
  it("draws two strokes that swing opposite ways", () => {
    const { container } = render(<AnimatedCloseIcon label="Close" size={14} />);
    expect(screen.getByRole("img", { name: "Close" })).toBeInTheDocument();
    const arms = [
      ...container.querySelectorAll<SVGGElement>("[data-part=arm]"),
    ].map((arm) => arm.style.getPropertyValue("--part-x"));
    expect(arms).toEqual(["-1", "1"]);
  });
  it("draws its bold strokes", () => {
    const { container } = render(<AnimatedCloseIcon size={12} weight="bold" />);
    expect(container.querySelectorAll("[data-part=arm]")).toHaveLength(2);
  });
});
