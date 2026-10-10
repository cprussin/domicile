import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import { loadEmittedStylesheet } from "../../emitted-stylesheet";
import { FloatShadow } from "./FloatShadow";

loadEmittedStylesheet(document);

const shadow = (container: HTMLElement): Element => {
  const element = container.querySelector("[data-shadow]");
  if (element === null) {
    throw new Error("test: the shadow rendered no element");
  } else {
    return element;
  }
};

describe("FloatShadow", () => {
  it("stays opaque while its window is dragged", () => {
    const { container } = render(
      <FloatShadow
        depth={0}
        dragging
        frame={{ height: 300, width: 400, x: 20, y: 52 }}
        motion="resting"
      />,
    );

    // Unset, so it draws at full opacity.
    expect(globalThis.getComputedStyle(shadow(container)).opacity).toBe("");
  });

  // A scratchpad window hangs from the screen's top edge.
  it("squares its top corners while its window hangs", () => {
    const { container } = render(
      <FloatShadow
        depth={0}
        dragging={false}
        frame={{ height: 300, width: 400, x: 20, y: 0 }}
        hanging
        motion="resting"
      />,
    );
    const style = globalThis.getComputedStyle(shadow(container));

    expect(style.borderStartStartRadius).toBe("");
    expect(style.borderStartEndRadius).toBe("");
    expect(style.borderEndStartRadius).not.toBe("");
  });
});
