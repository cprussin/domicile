import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedChatIcon } from "./AnimatedChatIcon";

describe(AnimatedChatIcon, () => {
  it("tips its bubble and writes its lines on a new cue", () => {
    const { container, rerender } = render(
      <AnimatedChatIcon cue={1} size={15} />,
    );
    expect(container.querySelector("[data-cued]")).toBeNull();
    rerender(<AnimatedChatIcon cue={2} size={15} />);
    expect(container.querySelectorAll("[data-cued]")).toHaveLength(3);
  });
});
