import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedBluetoothIcon } from "./AnimatedBluetoothIcon";

const dotStates = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-part=dot]")].map((dot) =>
    dot.getAttribute("data-state"),
  );

describe(AnimatedBluetoothIcon, () => {
  it("shows the dots beside the rune while a device is connected", () => {
    const { container } = render(
      <AnimatedBluetoothIcon size={15} state="connected" />,
    );
    expect(dotStates(container)).toEqual(["shown", "shown"]);
  });

  it("tucks the dots away while nothing is connected", () => {
    const { container } = render(
      <AnimatedBluetoothIcon size={15} state="on" />,
    );
    expect(dotStates(container)).toEqual(["hidden", "hidden"]);
    expect(container.querySelector("svg")).not.toHaveAttribute("data-slashed");
  });

  it("is slashed while off", () => {
    const { container } = render(
      <AnimatedBluetoothIcon size={15} state="off" />,
    );
    expect(container.querySelector("svg")).toHaveAttribute("data-slashed");
  });
});
