import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { FocusGlow } from "./FocusGlow";

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

/** A group of two windows, title bars included. */
const RECT = { height: 830, width: 1200, x: 20, y: 52 };

/** Default props; each test overrides what it checks. */
const glowProps = {
  depth: 0,
  dragging: false,
  leaving: false,
  motion: "resting",
  rect: RECT,
  windows: ["app:term", "app:editor"],
} as const;

const glow = (container: HTMLElement): HTMLElement => {
  const element = container.firstElementChild;
  if (element instanceof HTMLElement) {
    return element;
  } else {
    throw new Error("test: the glow rendered no element");
  }
};

describe("FocusGlow", () => {
  it("rings its box in the accent and glows into the gaps around it", () => {
    const { container } = render(<FocusGlow {...glowProps} />);

    expect(glow(container).className).toContain(
      css({
        boxShadow:
          "0 0 0 1px color-mix(in oklab, {colors.accent} 70%, transparent), 0 0 {spacing.9} color-mix(in oklab, {colors.accent} 45%, transparent), {shadows.lifted}",
      }),
    );
  });

  it("names the windows it lights", () => {
    const { container } = render(<FocusGlow {...glowProps} />);

    expect(glow(container)).toHaveAttribute(
      "data-focus-box",
      "app:term app:editor",
    );
  });

  it("takes no pointer from the windows under it", () => {
    const { container } = render(<FocusGlow {...glowProps} />);

    expect(globalThis.getComputedStyle(glow(container)).pointerEvents).toBe(
      "none",
    );
  });

  it("covers its box at the depth of the windows it lights", () => {
    const { container } = render(<FocusGlow {...glowProps} depth={3} />);

    expect(glow(container)).toHaveStyle({
      blockSize: "830px",
      inlineSize: "1200px",
      insetBlockStart: "52px",
      insetInlineStart: "20px",
      zIndex: "3",
    });
  });

  // Focus follows the pointer, so a glow that slid to the next window would
  // chase it around the screen. Each box fades in and out where it is.
  describe("fading", () => {
    it("fades in from nothing", () => {
      const { container } = render(<FocusGlow {...glowProps} />);

      expect(glow(container).className).toContain(
        css({ _starting: { opacity: 0 } }),
      );
      expect(globalThis.getComputedStyle(glow(container)).opacity).toBe("1");
    });

    it("fades out where it is once focus leaves", () => {
      const { container } = render(<FocusGlow {...glowProps} leaving />);

      expect(glow(container)).toHaveAttribute("data-leaving");
      expect(globalThis.getComputedStyle(glow(container)).opacity).toBe("0");
      expect(globalThis.getComputedStyle(glow(container)).transition).toContain(
        "opacity",
      );
    });
  });

  // Otherwise the glow would be left behind around an empty box.
  it("plays the motion of the window it lights, about its own middle", () => {
    const { container } = render(<FocusGlow {...glowProps} motion="opening" />);

    expect(globalThis.getComputedStyle(glow(container)).animation).toContain(
      "windowOpening",
    );
    expect(glow(container)).toHaveStyle({ transformOrigin: "600px 415px" });
  });

  it("shuffles with its window when that window trades places in the stack", () => {
    const { container } = render(
      <FocusGlow
        {...glowProps}
        motion="restacking"
        restack={{ away: { x: 40, y: 0 }, from: 1, id: "app:term", to: 2 }}
      />,
    );

    expect(glow(container).style.getPropertyValue("--restack-to")).toBe("2");
  });

  it("follows its window exactly while that window is being dragged", () => {
    const { container } = render(<FocusGlow {...glowProps} dragging />);

    expect(
      globalThis.getComputedStyle(glow(container)).transition,
    ).not.toContain("inline-size");
  });
});
