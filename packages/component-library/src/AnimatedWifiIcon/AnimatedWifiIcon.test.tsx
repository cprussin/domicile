import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { AnimatedWifiIcon } from "./AnimatedWifiIcon";

const arcStates = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-part=arc]")].map((arc) =>
    arc.getAttribute("data-state"),
  );

describe(AnimatedWifiIcon, () => {
  it("lights as many arcs as the signal has bars", () => {
    const { container } = render(<AnimatedWifiIcon bars={2} size={15} />);
    expect(arcStates(container)).toEqual(["lit", "lit", "unlit"]);
  });

  it("dims unlit arcs rather than hiding them, so the icon keeps its shape", () => {
    const { container } = render(<AnimatedWifiIcon bars={1} size={15} />);
    expect(
      container.querySelector("[data-state=unlit]")?.getAttribute("class"),
    ).toContain(css({ "&[data-state=unlit]": { opacity: "inactive" } }));
  });

  it("pulses every arc in turn while connecting", () => {
    const { container } = render(
      <AnimatedWifiIcon bars={1} connecting size={15} />,
    );
    expect(arcStates(container)).toEqual([
      "connecting",
      "connecting",
      "connecting",
    ]);
  });

  it("is slashed while off, with every arc drawn", () => {
    const { container } = render(<AnimatedWifiIcon bars={1} off size={15} />);
    expect(container.querySelector("svg")).toHaveAttribute("data-slashed");
    expect(arcStates(container)).toEqual(["lit", "lit", "lit"]);
  });
});
