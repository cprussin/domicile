import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { css } from "../../styled-system/css";
import { DisplayProvider } from "./DisplayProvider";
import type { Display, DisplaySource } from "./display-source";
import { Screen } from "./Screen";

const LEFT: Display = {
  name: "left",
  position: [0, 0],
  scale: 1,
  size: [1920, 1080],
};

const RIGHT: Display = {
  name: "right",
  position: [1920, 120],
  scale: 2,
  size: [2560, 1440],
};

const describing = (
  displays: readonly Display[] | undefined,
): DisplaySource => ({
  displays,
  onDisplays: () => () => undefined,
});

/** Renders `children` on a desktop of `displays`. */
const on = (displays: readonly Display[] | undefined, children: ReactNode) => {
  const { rerender } = render(
    <DisplayProvider source={describing(displays)}>{children}</DisplayProvider>,
  );
  return {
    /** The same tree on a desktop that has since been described again. */
    redescribed: (described: readonly Display[]) => {
      rerender(
        <DisplayProvider source={describing(described)}>
          {children}
        </DisplayProvider>,
      );
    },
  };
};

/**
 * The regions `<Screen>` laid out, in order, each as its rectangle.
 *
 * Physical `left`/`top` rather than the logical `inset-inline-start`: a
 * display's position is desktop geometry, and a shell in a right-to-left
 * locale must not put the left-hand monitor on the right.
 */
const regions = (): string[] =>
  [...document.querySelectorAll("[data-screen]")].map((region) => {
    const { left, top, width, height } = (region as HTMLElement).style;
    return `${left},${top}+${width}x${height}`;
  });

describe("Screen", () => {
  it("takes its region out of the page's flow", () => {
    // The whole premise: the page spans the desktop and a screen is a region
    // of it, so a screen laid out in flow is a screen wherever the content
    // above it happens to end. Compared against the same declaration rather
    // than asserted as a class name, since Panda hashes them.
    on([LEFT], <Screen name="left">stuff</Screen>);
    const region = document.querySelector("[data-screen]");
    expect(region?.className).toBe(css({ position: "absolute" }));
  });

  it("names the display each region belongs to", () => {
    // What a shell styles and a test selects on. Without it every region is
    // anonymous and `[data-screen="left"]` addresses nothing.
    on([LEFT, RIGHT], <Screen everywhere>stuff</Screen>);
    expect(
      [...document.querySelectorAll("[data-screen]")].map((region) =>
        region.getAttribute("data-screen"),
      ),
    ).toEqual(["left", "right"]);
  });

  it("puts its children over the display it names", () => {
    on([LEFT, RIGHT], <Screen name="right">stuff</Screen>);
    expect(screen.getByText("stuff")).toBeInTheDocument();
    expect(regions()).toEqual(["1920px,120px+2560pxx1440px"]);
  });

  it("renders nothing for a name no display has", () => {
    // A screen that is not plugged in costs the shell an empty region rather
    // than an error: the same config drives a docked and an undocked laptop.
    on([LEFT], <Screen name="right">stuff</Screen>);
    expect(screen.queryByText("stuff")).not.toBeInTheDocument();
  });

  it("renders nothing until the host has described the desktop", () => {
    on(undefined, <Screen name="left">stuff</Screen>);
    expect(screen.queryByText("stuff")).not.toBeInTheDocument();
  });

  it("renders once per display when told `everywhere`", () => {
    on([LEFT, RIGHT], <Screen everywhere>clock</Screen>);
    expect(screen.getAllByText("clock")).toHaveLength(2);
    expect(regions()).toEqual([
      "0px,0px+1920pxx1080px",
      "1920px,120px+2560pxx1440px",
    ]);
  });

  it("renders once per display a `match` accepts", () => {
    on([LEFT, RIGHT], <Screen match={(d) => d.scale > 1}>wallpaper</Screen>);
    expect(screen.getAllByText("wallpaper")).toHaveLength(1);
    expect(regions()).toEqual(["1920px,120px+2560pxx1440px"]);
  });

  it("keeps a region where it is when the desktop is described again", () => {
    // The desktop is re-described whenever it changes, and a region is the
    // same children placed over a display: a region keyed by which display it
    // is would be torn down and built again the moment a monitor is unplugged
    // or a config is reloaded. For a shell whose chrome is on one screen that
    // is an embedded page reloaded to where it started and every portal
    // re-created blank, with nothing on the page to show that it happened.
    const { redescribed } = on(
      [LEFT, RIGHT],
      <Screen everywhere>stuff</Screen>,
    );
    const first = document.querySelector("[data-screen]");

    redescribed([RIGHT]);

    expect(document.querySelector("[data-screen]")).toBe(first);
    expect(first?.getAttribute("data-screen")).toBe("right");
    expect(regions()).toEqual(["1920px,120px+2560pxx1440px"]);
  });

  it("hands `match` the whole display, not just its name", () => {
    // A predicate is worth having only if it can see what a name cannot.
    const seen: Display[] = [];
    on(
      [LEFT, RIGHT],
      <Screen
        match={(display) => {
          seen.push(display);
          return false;
        }}
      >
        nothing
      </Screen>,
    );
    expect(seen).toEqual([LEFT, RIGHT]);
  });
});
