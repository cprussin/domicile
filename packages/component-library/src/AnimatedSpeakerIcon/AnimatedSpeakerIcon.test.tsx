import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedSpeakerIcon } from "./AnimatedSpeakerIcon";

const waveStates = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-part=wave]")].map((wave) =>
    wave.getAttribute("data-state"),
  );

describe(AnimatedSpeakerIcon, () => {
  it.each([
    [0, ["hidden", "hidden"]],
    [0.3, ["shown", "hidden"]],
    [0.5, ["shown", "shown"]],
  ])("shows waves for the volume %d", (volume, waves) => {
    const { container } = render(
      <AnimatedSpeakerIcon
        muted={false}
        size={15}
        volume={volume}
        weight="bold"
      />,
    );
    expect(waveStates(container)).toEqual(waves);
  });

  it("hides the waves and is slashed while muted", () => {
    const { container } = render(
      <AnimatedSpeakerIcon muted size={15} volume={1} weight="bold" />,
    );
    expect(waveStates(container)).toEqual(["hidden", "hidden"]);
    expect(container.querySelector("svg")).toHaveAttribute("data-slashed");
  });

  it("pulses the waves when the volume changes", () => {
    const { container, rerender } = render(
      <AnimatedSpeakerIcon
        muted={false}
        size={15}
        volume={0.7}
        weight="bold"
      />,
    );
    expect(container.querySelector("[data-cued]")).toBeNull();
    rerender(
      <AnimatedSpeakerIcon
        muted={false}
        size={15}
        volume={0.8}
        weight="bold"
      />,
    );
    expect(container.querySelectorAll("[data-cued]")).toHaveLength(2);
  });
});
