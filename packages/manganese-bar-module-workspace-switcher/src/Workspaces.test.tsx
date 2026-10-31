import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { css } from "../styled-system/css";
import { Workspaces } from "./Workspaces";

/**
 * The switcher with four workspaces and the second on screen. Includes the
 * tenth to test that a two-digit label still fits.
 */
const switcher = (focused = true) => {
  render(
    <Workspaces
      current="2"
      focused={focused}
      onSelect={() => undefined}
      workspaces={["1", "2", "3", "10"]}
    />,
  );
  return (name: string) => screen.getByRole("button", { name });
};

const chip = css({ backgroundColor: "onPhoto" });

describe("Workspaces", () => {
  it("draws the one on screen as a solid white chip with a black number", () => {
    const workspace = switcher();

    expect(workspace("2").className).toContain(chip);
    expect(workspace("2").className).toContain(css({ color: "black" }));
    expect(workspace("2").className).toContain(css({ textShadow: "none" }));
  });

  it("outlines the one on screen on a screen the keyboard is not on", () => {
    // One workspace has keyboard focus and it is on one screen: sway's
    // `focused_workspace` versus `active_workspace`.
    const workspace = switcher(false);

    expect(workspace("2").className).not.toContain(chip);
    expect(workspace("2").className).toContain(
      css({ boxShadow: "inset 0 0 0 0.09375rem {colors.onPhoto}" }),
    );
  });

  it("leaves the rest of them clear and only slightly dimmed", () => {
    const workspace = switcher();

    expect(workspace("1").className).toContain(
      css({ backgroundColor: "transparent" }),
    );
    expect(workspace("1").className).toContain(
      css({ color: "color-mix(in oklab, {colors.onPhoto} 85%, transparent)" }),
    );
    expect(workspace("1").className).not.toContain(chip);
  });

  it("keeps the chip white under the pointer", () => {
    // `_hoverEnabled` skips `aria-current`, so hovering the chip doesn't
    // swap its fill for the hover square.
    const workspace = switcher();

    expect(workspace("1").className).toContain(
      css({ _hoverEnabled: { backgroundColor: "fillOverPhoto" } }),
    );
    expect(workspace("1").className).not.toContain(
      css({ _hover: { backgroundColor: "fillOverPhoto" } }),
    );
  });

  it("centers the number rather than its baseline", () => {
    // Digits have no ascenders or descenders, so centering the line box leaves
    // them a few pixels high. Trimming the box to cap height and baseline
    // centers the glyph, and the trim only works on a block container.
    const workspace = switcher();

    for (const name of ["1", "2", "3", "10"]) {
      expect(workspace(name).className).toContain(
        css({ textBox: "trim-both cap alphabetic" }),
      );
      expect(workspace(name).className).toContain(css({ display: "block" }));
    }
  });

  it("draws every one of them as a rounded square that two digits widen", () => {
    const workspace = switcher();

    for (const name of ["1", "2", "3", "10"]) {
      expect(workspace(name).className).toContain(css({ borderRadius: "lg" }));
      expect(workspace(name).className).toContain(css({ blockSize: 6 }));
      expect(workspace(name).className).toContain(css({ minInlineSize: 6 }));
    }
  });
});
