import { describe, expect, it } from "bun:test";
import { loadEmittedStylesheet } from "@domicile-desktop/test-support/emitted-stylesheet";
import { render } from "@testing-library/react";
import { recordedSettles } from "../recorded-settles";
import { FloatShadow } from "./FloatShadow";

loadEmittedStylesheet(
  document,
  new URL("../../styled-system/styles.css", import.meta.url),
);

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

  it("moves with its window, following it exactly while it is dragged", () => {
    const frame = { height: 300, width: 400, x: 20, y: 52 };
    const played = (dragging: boolean) => {
      const settles = recordedSettles();
      const { rerender } = render(
        <FloatShadow
          depth={0}
          dragging={dragging}
          frame={frame}
          motion="resting"
          settler={settles.settler}
        />,
      );
      rerender(
        <FloatShadow
          depth={0}
          dragging={dragging}
          frame={{ ...frame, x: 120 }}
          motion="resting"
          settler={settles.settler}
        />,
      );
      return settles.played;
    };

    expect(played(false)).toStrictEqual([
      { scaleX: 1, scaleY: 1, x: -100, y: 0 },
    ]);
    expect(played(true)).toStrictEqual([undefined]);
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
