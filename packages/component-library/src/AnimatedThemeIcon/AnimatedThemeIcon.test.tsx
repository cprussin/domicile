import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedThemeIcon } from "./AnimatedThemeIcon";

const statesOf = (container: HTMLElement, part: string) => [
  ...new Set(
    [...container.querySelectorAll(`[data-part=${part}]`)].map((element) =>
      element.getAttribute("data-state"),
    ),
  ),
];

describe(AnimatedThemeIcon, () => {
  it("shows the moon while dark", () => {
    const { container } = render(
      <AnimatedThemeIcon dark size={16} weight="bold" />,
    );
    expect(statesOf(container, "moon")).toEqual(["shown"]);
    expect(statesOf(container, "ray")).toEqual(["hidden"]);
    expect(statesOf(container, "core")).toEqual(["hidden"]);
  });

  it("shows the sun while light", () => {
    const { container } = render(
      <AnimatedThemeIcon dark={false} size={16} weight="fill" />,
    );
    expect(statesOf(container, "moon")).toEqual(["hidden"]);
    expect(statesOf(container, "ray")).toEqual(["shown"]);
    expect(statesOf(container, "core")).toEqual(["shown"]);
  });
});
