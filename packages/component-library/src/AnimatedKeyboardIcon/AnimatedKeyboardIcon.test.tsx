import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedKeyboardIcon } from "./AnimatedKeyboardIcon";

describe(AnimatedKeyboardIcon, () => {
  it("presses its keys in turn on a new cue", () => {
    const { container, rerender } = render(
      <AnimatedKeyboardIcon cue="us" size={15} />,
    );
    expect(container.querySelector("[data-cued]")).toBeNull();
    rerender(<AnimatedKeyboardIcon cue="de" size={15} />);
    expect(
      container.querySelectorAll("[data-part=key] [data-cued]"),
    ).toHaveLength(5);
  });
});
