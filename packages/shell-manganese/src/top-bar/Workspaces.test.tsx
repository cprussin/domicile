import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { Workspaces } from "./Workspaces";

/**
 * The switcher over four workspaces, with the second of them on screen. The
 * tenth is in the list because two digits are the case a circle drawn around
 * its contents stops being a circle for.
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
    // One workspace has the keyboard, and it is on one screen: sway's
    // `focused_workspace` against its `active_workspace`.
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
    // A line box is as tall as the font's ascent and descent, and a digit
    // has neither an accent above it nor a tail below: centering that box
    // leaves the figure sitting a couple of pixels high in the ring.
    // Trimming the box to the cap and the baseline is what centers what is
    // actually drawn — and the trim is only honored on a block container,
    // which is why the chip is one rather than a flex box.
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
      // The size, not a floor on it: a circle that took the width of what is
      // written in it is a lozenge around `10`.
      expect(workspace(name).className).toContain(css({ inlineSize: 6 }));
    }
  });
});
