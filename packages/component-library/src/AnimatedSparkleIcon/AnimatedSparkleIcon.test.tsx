import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { AnimatedSparkleIcon } from "./AnimatedSparkleIcon";

describe(AnimatedSparkleIcon, () => {
  it("draws a star and two glints that twinkle in turn", () => {
    const { container } = render(
      <AnimatedSparkleIcon label="Launcher" size={15} />,
    );
    expect(screen.getByRole("img", { name: "Launcher" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-part=star]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-part=glint]")).toHaveLength(2);
  });
});
