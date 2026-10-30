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

const lit = css({ backgroundColor: "fillOverPhoto" });
const dimmed = css({
  color: "color-mix(in oklab, {colors.white} 55%, transparent)",
});

describe("Workspaces", () => {
  it("lights the one on screen and writes it in full white", () => {
    const workspace = switcher();

    expect(workspace("2").className).toContain(lit);
    expect(workspace("2").className).toContain(css({ color: "white" }));
  });

  it("gives the one on screen a fainter square on a screen the keyboard is not on", () => {
    // One workspace has keyboard focus and it is on one screen: sway's
    // `focused_workspace` versus `active_workspace`.
    const workspace = switcher(false);

    expect(workspace("2").className).not.toContain(lit);
    expect(workspace("2").className).toContain(
      css({
        backgroundColor: "color-mix(in oklab, {colors.white} 8%, transparent)",
      }),
    );
  });

  it("leaves the rest of them clear and dimmed", () => {
    const workspace = switcher();

    expect(workspace("1").className).toContain(
      css({ backgroundColor: "transparent" }),
    );
    expect(workspace("1").className).toContain(dimmed);
    expect(workspace("1").className).not.toContain(lit);
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
