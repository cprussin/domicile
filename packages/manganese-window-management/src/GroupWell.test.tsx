import { describe, expect, it } from "bun:test";
import { loadEmittedStylesheet } from "@domicile-desktop/test-support/emitted-stylesheet";
import { render } from "@testing-library/react";

import { css } from "../styled-system/css";
import { GroupWell } from "./GroupWell";

// Loads the real stylesheet so motion and settling styles resolve.
loadEmittedStylesheet(
  document,
  new URL("../styled-system/styles.css", import.meta.url),
);

/** The box under a strip, which a nested group sits in. */
const RECT = { height: 800, width: 1200, x: 20, y: 82 };

const wellProps = {
  castsShadow: false,
  depth: 0,
  dragging: false,
  motion: "resting",
  nested: false,
  rect: RECT,
} as const;

const well = (container: HTMLElement): HTMLElement => {
  const element = container.firstElementChild;
  if (element instanceof HTMLElement) {
    return element;
  } else {
    throw new Error("test: the well rendered no element");
  }
};

describe("GroupWell", () => {
  it("covers its box at the depth of the windows in it", () => {
    const { container } = render(<GroupWell {...wellProps} depth={3} />);

    expect(well(container)).toHaveStyle({
      blockSize: "800px",
      inlineSize: "1200px",
      insetBlockStart: "82px",
      insetInlineStart: "20px",
      zIndex: "3",
    });
  });

  it("matches the open tab it hangs from", () => {
    const { container } = render(<GroupWell {...wellProps} />);

    expect(well(container).className).toContain(
      css({
        backgroundColor:
          "color-mix(in oklab, {colors.foreground} 14%, {colors.background})",
      }),
    );
  });

  it("casts a float's shadow only when asked to", () => {
    const shadow = css({ boxShadow: "lifted" });

    expect(
      well(render(<GroupWell {...wellProps} castsShadow />).container)
        .className,
    ).toContain(shadow);
    expect(
      well(render(<GroupWell {...wellProps} />).container).className,
    ).not.toContain(shadow);
  });

  it("draws its edge stronger inside another group's well", () => {
    const strong = css({
      borderColor:
        "color-mix(in oklab, {colors.foreground} 40%, {colors.background})",
    });

    expect(
      well(render(<GroupWell {...wellProps} nested />).container).className,
    ).toContain(strong);
    expect(
      well(render(<GroupWell {...wellProps} />).container).className,
    ).not.toContain(strong);
  });

  it("takes no pointer from the windows in it", () => {
    const { container } = render(<GroupWell {...wellProps} />);

    expect(globalThis.getComputedStyle(well(container)).pointerEvents).toBe(
      "none",
    );
  });
});
