import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { AnimatedLightningIcon } from "./AnimatedLightningIcon";

describe(AnimatedLightningIcon, () => {
  it("sits where it is placed in an outer drawing", () => {
    render(
      <svg>
        <AnimatedLightningIcon label="Charging" size={8} x={7.5} y={2} />
      </svg>,
    );
    const bolt = screen.getByRole("img", { name: "Charging" });
    expect(bolt).toHaveAttribute("x", "7.5");
    expect(bolt).toHaveAttribute("y", "2");
  });
});
