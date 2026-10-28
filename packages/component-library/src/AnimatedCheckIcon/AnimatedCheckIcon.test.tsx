import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedCheckIcon } from "./AnimatedCheckIcon";

describe(AnimatedCheckIcon, () => {
  it("draws a check", () => {
    const { container } = render(<AnimatedCheckIcon size={14} />);
    expect(container.querySelector("[data-part=check]")).not.toBeNull();
  });
});
