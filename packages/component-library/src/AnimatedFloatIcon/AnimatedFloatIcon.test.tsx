import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedFloatIcon } from "./AnimatedFloatIcon";

const statesOf = (container: HTMLElement, part: string) =>
  [...container.querySelectorAll(`[data-part=${part}]`)].map((node) =>
    node.getAttribute("data-state"),
  );

describe(AnimatedFloatIcon, () => {
  it("shows two windows while the window is tiled", () => {
    const { container } = render(
      <AnimatedFloatIcon floating={false} size={14} />,
    );
    expect(statesOf(container, "front")).toEqual(["shown"]);
    expect(statesOf(container, "back")).toEqual(["shown"]);
    expect(statesOf(container, "square")).toEqual([
      "hidden",
      "hidden",
      "hidden",
      "hidden",
    ]);
  });

  it("hides the window behind where the one in front covers it", () => {
    const { container } = render(
      <AnimatedFloatIcon floating={false} size={14} />,
    );
    const mask = container.querySelector("mask");
    expect(mask?.querySelector("[data-part=front-outline]")).not.toBeNull();
    expect(
      container.querySelector("[data-part=back]")?.parentElement,
    ).toHaveAttribute("mask", `url(#${mask?.id ?? ""})`);
  });

  it("changes to squares in the same drawing once the window floats", () => {
    const { container, rerender } = render(
      <AnimatedFloatIcon floating={false} size={14} />,
    );
    const svg = container.querySelector("svg");
    rerender(<AnimatedFloatIcon floating size={14} />);
    expect(container.querySelector("svg")).toBe(svg);
    expect(statesOf(container, "front")).toEqual(["hidden"]);
    expect(statesOf(container, "square")).toEqual([
      "shown",
      "shown",
      "shown",
      "shown",
    ]);
  });
});
