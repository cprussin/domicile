import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { loadEmittedStylesheet } from "../../emitted-stylesheet";
import { ScratchpadBackdrop } from "./ScratchpadBackdrop";

loadEmittedStylesheet(document);

const SCREEN = { height: 1080, width: 1920, x: 0, y: 0 };

const nothing = () => undefined;

const backdrop = (container: HTMLElement): Element => {
  const element = container.querySelector("[data-scratchpad-backdrop]");
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
        leaving
        onDismiss={nothing}
        screen={SCREEN}
      />,
    );

    expect(globalThis.getComputedStyle(backdrop(container)).pointerEvents).toBe(
      "none",
    );
  });
});
