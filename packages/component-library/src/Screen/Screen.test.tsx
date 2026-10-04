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

/** A 4K panel on its side at density 1.2. */
const SIDEWAYS: Display = {
  name: "sideways",
  position: [0, 0],
  scale: 2,
  size: [1800, 3200],
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
    /** Re-renders the same tree with a new display list. */
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
 * The rectangles of the rendered `<Screen>` regions, in order.
 *
 * Reads physical `left`/`top`, since display positions must not flip in
 * right-to-left locales.
 */
const regions = (): string[] =>
  [...document.querySelectorAll("[data-screen]")].map((region) => {
    const { left, top, width, height } = (region as HTMLElement).style;
    return `${left},${top}+${width}x${height}`;
  });

describe("Screen", () => {
  it("takes its region out of the page's flow", () => {
    // In flow, a region would land wherever earlier content ends. Compared
    // by declaration, since Panda hashes class names.
    on([LEFT], <Screen name="left">stuff</Screen>);
    const region = document.querySelector("[data-screen]");
    expect(region?.className).toBe(css({ position: "absolute" }));
  });

  it("names the display each region belongs to", () => {
    // Shells style on it and tests select on it.
    on([LEFT, RIGHT], <Screen everywhere>stuff</Screen>);
    expect(
      [...document.querySelectorAll("[data-screen]")].map((region) =>
        region.getAttribute("data-screen"),
      ),
    ).toEqual(["left", "right"]);
  });

  it("lays a turned monitor's region out as it is, upright and logical", () => {
    // The engine rotates and scales each monitor's slice. A transform here
    // would rotate it twice and leave portals outside the region unrotated.
    on([SIDEWAYS], <Screen name="sideways">stuff</Screen>);
    const region = document.querySelector("[data-screen]") as HTMLElement;
    expect(region.style.transform).toBe("");
    expect(regions()).toEqual(["0px,0px+1800pxx3200px"]);
  });

  it("puts its children over the display it names", () => {
    on([LEFT, RIGHT], <Screen name="right">stuff</Screen>);
    expect(screen.getByText("stuff")).toBeInTheDocument();
    expect(regions()).toEqual(["1920px,120px+2560pxx1440px"]);
  });

  it("renders nothing for a name no display has", () => {
    // The same config serves a docked and an undocked laptop.
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
    // Keying by display would remount the region when monitors change,
    // reloading embedded pages and resetting portals.
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
