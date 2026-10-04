import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { Scrim } from "./Scrim";

// Loads the real stylesheet so motion and settling styles resolve. See
// `TitleBar.test.tsx` for why the layers are stripped.
const stylesheet = document.createElement("style");
stylesheet.textContent = readFileSync(
  new URL("../../styled-system/styles.css", import.meta.url),
  "utf8",
)
  .replaceAll(/@layer [^;{]+;/g, "")
  .replaceAll(/@layer [^{]+\{/g, "@media all{");
document.head.append(stylesheet);

/** A window's full frame, title bar included. */
const FRAME = { height: 830, width: 1200, x: 0, y: 32 };

/** Default props; each test overrides what it checks. */
const scrimProps = {
  depth: 0,
  dimmed: true,
  dragging: false,
  frame: FRAME,
  motion: "resting",
  rect: FRAME,
  tab: false,
  window: "app:term",
} as const;

const scrim = (container: HTMLElement): HTMLElement => {
  const element = container.firstElementChild;
  if (element instanceof HTMLElement) {
    return element;
  } else {
    throw new Error("test: the scrim rendered no element");
  }
};

describe("Scrim", () => {
  it("washes what it covers in the page's own ground while it is dimmed", () => {
    const wash = css({
      backgroundColor:
        "color-mix(in oklab, {colors.background} 55%, transparent)",
    });

    const dimmed = render(<Scrim {...scrimProps} />);
    expect(scrim(dimmed.container).className).toContain(wash);
    expect(scrim(dimmed.container)).toHaveAttribute("data-dimmed");

    const clear = render(<Scrim {...scrimProps} dimmed={false} />);
    expect(scrim(clear.container).className).toContain(
      css({ backgroundColor: "transparent" }),
    );
    expect(scrim(clear.container)).not.toHaveAttribute("data-dimmed");
  });

  it("names the window it is over", () => {
    const { container } = render(<Scrim {...scrimProps} />);

    expect(scrim(container)).toHaveAttribute("data-scrim", "app:term");
  });

  it("takes no pointer from the window under it", () => {
    const { container } = render(<Scrim {...scrimProps} />);

    expect(globalThis.getComputedStyle(scrim(container)).pointerEvents).toBe(
      "none",
    );
  });

  it("covers its box at the depth of the window it is over", () => {
    const { container } = render(<Scrim {...scrimProps} depth={3} />);

    expect(scrim(container)).toHaveStyle({
      blockSize: "830px",
      inlineSize: "1200px",
      insetBlockStart: "32px",
      zIndex: "3",
    });
  });

  // Otherwise the scrim would be left behind as a gray box.
  it("plays the motion of the window it is over, about that window's middle", () => {
    const { container } = render(<Scrim {...scrimProps} motion="opening" />);

    expect(globalThis.getComputedStyle(scrim(container)).animation).toContain(
      "windowOpening",
    );
    expect(scrim(container)).toHaveStyle({ transformOrigin: "600px 415px" });
  });

  it("shuffles with its window when that window trades places in the stack", () => {
    const { container } = render(
      <Scrim
        {...scrimProps}
        motion="restacking"
        restack={{ away: { x: 40, y: 0 }, from: 1, id: "app:term", to: 2 }}
      />,
    );

    expect(scrim(container).style.getPropertyValue("--restack-to")).toBe("2");
  });

  // Focus follows the cursor, so the dim changes often.
  it("eases in and out of the wash", () => {
    const { container } = render(<Scrim {...scrimProps} />);

    expect(globalThis.getComputedStyle(scrim(container)).transition).toContain(
      "background-color",
    );
  });

  it("follows its window exactly while that window is being dragged", () => {
    const { container } = render(<Scrim {...scrimProps} dragging />);

    expect(
      globalThis.getComputedStyle(scrim(container)).transition,
    ).not.toContain("inline-size");
  });

  it("rounds the corners a window's frame does, and a tab's top ones only", () => {
    const frame = globalThis.getComputedStyle(
      scrim(render(<Scrim {...scrimProps} />).container),
    );
    expect(frame.borderEndStartRadius).not.toBe("");
    expect(frame.borderStartStartRadius).not.toBe("");

    const tab = globalThis.getComputedStyle(
      scrim(render(<Scrim {...scrimProps} tab />).container),
    );
    expect(tab.borderStartStartRadius).not.toBe("");
    expect(tab.borderEndStartRadius).toBe("");
  });
});
