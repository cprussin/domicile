import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { AnimatedPlusIcon } from "./AnimatedPlusIcon";

describe(AnimatedPlusIcon, () => {
  it("draws an arm across and an arm down", () => {
    const { container } = render(
      <AnimatedPlusIcon label="New tab" size={12} />,
    );
    expect(screen.getByRole("img", { name: "New tab" })).toBeInTheDocument();
    const arms = [
      ...container.querySelectorAll<SVGGElement>("[data-part=arm]"),
    ].map((arm) => [
      arm.style.getPropertyValue("--part-x"),
      arm.style.getPropertyValue("--part-y"),
    ]);
    expect(arms).toEqual([
      ["1", "0"],
      ["0", "1"],
    ]);
  });
  it("draws its bold strokes", () => {
    const { container } = render(<AnimatedPlusIcon size={12} weight="bold" />);
    expect(container.querySelectorAll("[data-part=arm]")).toHaveLength(2);
  });
});
