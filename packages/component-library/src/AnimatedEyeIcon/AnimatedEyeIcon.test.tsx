import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedEyeIcon } from "./AnimatedEyeIcon";

const stateOf = (container: HTMLElement, part: string) =>
  container.querySelector(`[data-part=${part}]`)?.getAttribute("data-state");

describe(AnimatedEyeIcon, () => {
  it("is open", () => {
    const { container } = render(<AnimatedEyeIcon open size={15} />);
    expect(stateOf(container, "outline")).toBe("shown");
    expect(stateOf(container, "pupil")).toBe("shown");
    expect(stateOf(container, "closed")).toBe("hidden");
  });

  it("is shut", () => {
    const { container } = render(<AnimatedEyeIcon open={false} size={15} />);
    expect(stateOf(container, "outline")).toBe("hidden");
    expect(stateOf(container, "pupil")).toBe("hidden");
    expect(stateOf(container, "closed")).toBe("shown");
  });
});
