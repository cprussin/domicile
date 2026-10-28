import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedBellIcon } from "./AnimatedBellIcon";

describe(AnimatedBellIcon, () => {
  it("hangs still when it mounts", () => {
    const { container } = render(<AnimatedBellIcon cue={2} size={15} />);
    expect(container.querySelector("[data-cued]")).toBeNull();
  });

  it("swings its body and clapper on a new cue", () => {
    const { container, rerender } = render(
      <AnimatedBellIcon cue={2} size={15} />,
    );
    rerender(<AnimatedBellIcon cue={3} size={15} />);
    expect(container.querySelectorAll("[data-cued]")).toHaveLength(2);
  });

  it("is slashed while off", () => {
    const { container } = render(<AnimatedBellIcon off size={15} />);
    expect(container.querySelector("svg")).toHaveAttribute("data-slashed");
  });
});
