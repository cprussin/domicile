import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { AnimatedDownloadIcon } from "./AnimatedDownloadIcon";

describe(AnimatedDownloadIcon, () => {
  it("drops its arrow afresh on a new cue", () => {
    const { container, rerender } = render(
      <AnimatedDownloadIcon cue={1} size={14} />,
    );
    const arrow = container.querySelector("[data-part=arrow] path");
    rerender(<AnimatedDownloadIcon cue={2} size={14} />);
    expect(container.querySelector("[data-part=arrow] path")).not.toBe(arrow);
    expect(container.querySelectorAll("[data-cued]")).toHaveLength(2);
  });
});
