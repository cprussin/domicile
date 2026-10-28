import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedMaximizeIcon } from "./AnimatedMaximizeIcon";

const statesOf = (container: HTMLElement, part: string) =>
  [...container.querySelectorAll(`[data-part=${part}]`)].map((node) =>
    node.getAttribute("data-state"),
  );

describe(AnimatedMaximizeIcon, () => {
  it("points its corners out while the window is not maximized", () => {
    const { container } = render(
      <AnimatedMaximizeIcon maximized={false} size={14} />,
    );
    expect(statesOf(container, "corner-out")).toEqual([
      "shown",
      "shown",
      "shown",
      "shown",
    ]);
    expect(statesOf(container, "corner-in")).toEqual([
      "hidden",
      "hidden",
      "hidden",
      "hidden",
    ]);
  });

  it("points them in once it is", () => {
    const { container, rerender } = render(
      <AnimatedMaximizeIcon maximized={false} size={14} />,
    );
    rerender(<AnimatedMaximizeIcon maximized size={14} />);
    expect(statesOf(container, "corner-out")).toEqual([
      "hidden",
      "hidden",
      "hidden",
      "hidden",
    ]);
    expect(statesOf(container, "corner-in")).toEqual([
      "shown",
      "shown",
      "shown",
      "shown",
    ]);
  });
});
