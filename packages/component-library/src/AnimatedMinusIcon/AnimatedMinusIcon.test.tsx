import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { AnimatedMinusIcon } from "./AnimatedMinusIcon";

describe(AnimatedMinusIcon, () => {
  it("draws a bar that draws in", () => {
    const { container } = render(
      <AnimatedMinusIcon label="Zoom out" size={12} />,
    );
    expect(screen.getByRole("img", { name: "Zoom out" })).toBeInTheDocument();
    expect(
      container
        .querySelector<SVGGElement>("[data-part=bar]")
        ?.style.getPropertyValue("--part-x"),
    ).toBe("-1");
  });
});
