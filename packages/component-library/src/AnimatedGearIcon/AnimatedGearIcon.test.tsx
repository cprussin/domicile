import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedGearIcon } from "./AnimatedGearIcon";

describe(AnimatedGearIcon, () => {
  it("draws a gear that turns", () => {
    const { container } = render(<AnimatedGearIcon size={14} />);
    expect(container.querySelector("[data-part=gear]")).not.toBeNull();
  });
});
