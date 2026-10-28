import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedReloadIcon } from "./AnimatedReloadIcon";

const statesOf = (container: HTMLElement, part: string) =>
  [...container.querySelectorAll(`[data-part=${part}]`)].map((node) =>
    node.getAttribute("data-state"),
  );

describe(AnimatedReloadIcon, () => {
  it("shows the arrow while the page is not loading", () => {
    const { container } = render(
      <AnimatedReloadIcon loading={false} size={16} />,
    );
    expect(statesOf(container, "arrow")).toEqual(["shown"]);
    expect(statesOf(container, "arm")).toEqual(["hidden", "hidden"]);
  });

  it("turns into an X, in the same drawing, while it loads", () => {
    const { container, rerender } = render(
      <AnimatedReloadIcon loading={false} size={16} />,
    );
    const svg = container.querySelector("svg");
    rerender(<AnimatedReloadIcon loading size={16} />);
    expect(container.querySelector("svg")).toBe(svg);
    expect(statesOf(container, "arrow")).toEqual(["hidden"]);
    expect(statesOf(container, "arm")).toEqual(["shown", "shown"]);
  });
});
