import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import type { GroupLayout } from "./AnimatedLayoutIcon";
import { AnimatedLayoutIcon } from "./AnimatedLayoutIcon";

/** The parts `layout` shows. */
const shownFor = (layout: GroupLayout) => {
  const { container } = render(
    <AnimatedLayoutIcon layout={layout} size={14} />,
  );
  return [...container.querySelectorAll("[data-state=shown]")].map((part) =>
    part.getAttribute("data-part"),
  );
};

describe(AnimatedLayoutIcon, () => {
  it.each([
    ["row", ["frame", "divider"]],
    ["column", ["frame", "divider"]],
    ["stack", ["row", "row"]],
    ["tabs", ["tabs"]],
  ] as const)("shows a %s's parts", (layout, parts) => {
    expect(shownFor(layout)).toEqual([...parts]);
  });

  it("draws a row's divider down, and a column's across", () => {
    const row = render(<AnimatedLayoutIcon layout="row" size={14} />);
    const column = render(<AnimatedLayoutIcon layout="column" size={14} />);
    const shownDivider = (container: HTMLElement) =>
      container
        .querySelector("[data-part=divider][data-state=shown] path")
        ?.getAttribute("d");
    expect(shownDivider(row.container)).not.toBe(
      shownDivider(column.container),
    );
  });
});
