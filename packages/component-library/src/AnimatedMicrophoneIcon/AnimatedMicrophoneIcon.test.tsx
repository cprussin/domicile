import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedMicrophoneIcon } from "./AnimatedMicrophoneIcon";

describe(AnimatedMicrophoneIcon, () => {
  it("is slashed while muted", () => {
    const { container } = render(
      <AnimatedMicrophoneIcon muted size={14} weight="regular" />,
    );
    expect(container.querySelector("svg")).toHaveAttribute("data-slashed");
  });

  it("bobs its capsule when unmuted", () => {
    const { container, rerender } = render(
      <AnimatedMicrophoneIcon muted size={14} weight="regular" />,
    );
    rerender(
      <AnimatedMicrophoneIcon muted={false} size={14} weight="regular" />,
    );
    expect(container.querySelector("[data-cued]")).not.toBeNull();
    expect(container.querySelector("svg")).not.toHaveAttribute("data-slashed");
  });
});
