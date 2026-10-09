import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { Workspaces } from "./Workspaces";

/**
 * The switcher with four workspaces and the second on screen. Includes the
 * tenth to test that a two-digit label still gets a circle.
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

describe("Workspaces", () => {
  it("fills the one on screen and turns its number dark", () => {
    const workspace = switcher();

    expect(workspace("2").className).toContain(
      css({ backgroundColor: "white" }),
    );
    expect(workspace("2").className).toContain(css({ color: "black" }));
  });

  it("rings the one on screen, unfilled, on a screen the keyboard is not on", () => {
    // One workspace has keyboard focus and it is on one screen: sway's
    // `focused_workspace` versus `active_workspace`.
    const workspace = switcher(false);

    expect(workspace("2").className).not.toContain(
      css({ backgroundColor: "white" }),
    );
    expect(workspace("2").className).toContain(
      css({
        borderColor: "color-mix(in oklab, {colors.white} 70%, transparent)",
      }),
    );
  });

  it("leaves the rest of them clear, in the white the bar is written in", () => {
    const workspace = switcher();

    expect(workspace("1").className).toContain(
      css({ backgroundColor: "transparent" }),
    );
    expect(workspace("1").className).not.toContain(
      css({ backgroundColor: "white" }),
    );
  });

  it("centers the number on the circle rather than on its baseline", () => {
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

  it("draws every one of them as a circle, two digits and all", () => {
    const workspace = switcher();

    for (const name of ["1", "2", "3", "10"]) {
      expect(workspace(name).className).toContain(
        css({ borderRadius: "full" }),
      );
      expect(workspace(name).className).toContain(css({ blockSize: 6 }));
      // A fixed size, not a minimum, so `10` does not stretch the circle.
      expect(workspace(name).className).toContain(css({ inlineSize: 6 }));
    }
  });
});
