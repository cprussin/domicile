import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { AnimatedSquaresIcon } from "./AnimatedSquaresIcon";

describe(AnimatedSquaresIcon, () => {
  it("draws four squares that move apart", () => {
    const { container } = render(
      <AnimatedSquaresIcon label="Apps" size={15} />,
    );
    expect(screen.getByRole("img", { name: "Apps" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-part=square]")).toHaveLength(4);
  });
});
