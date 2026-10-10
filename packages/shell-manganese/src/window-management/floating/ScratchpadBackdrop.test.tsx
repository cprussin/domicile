import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { loadEmittedStylesheet } from "../../emitted-stylesheet";
import { ScratchpadBackdrop } from "./ScratchpadBackdrop";

loadEmittedStylesheet(document);

const SCREEN = { height: 1080, width: 1920, x: 0, y: 0 };

const nothing = () => undefined;

const backdrop = (container: HTMLElement): HTMLElement => {
  const element = container.querySelector<HTMLElement>(
    "[data-scratchpad-backdrop]",
  );
  if (element === null) {
    throw new Error("test: the backdrop rendered no element");
  } else {
    return element;
  }
};

describe("ScratchpadBackdrop", () => {
  // A press as the window slides away would hide nothing.
  it("lets the pointer through while it fades out", () => {
    const { container } = render(
      <ScratchpadBackdrop
        depth={1}
        motion="stowing"
        onDismiss={nothing}
        rewound={0}
        screen={SCREEN}
      />,
    );

    expect(globalThis.getComputedStyle(backdrop(container)).pointerEvents).toBe(
      "none",
    );
  });

  // A slide that cuts the other short starts partway in, like the window's.
  it("starts its fade as far in as the window's slide", () => {
    const { container } = render(
      <ScratchpadBackdrop
        depth={1}
        motion="dropping"
        onDismiss={nothing}
        rewound={300}
        screen={SCREEN}
      />,
    );

    expect(backdrop(container).style.getPropertyValue("--motion-delay")).toBe(
      "-300ms",
    );
  });
});
