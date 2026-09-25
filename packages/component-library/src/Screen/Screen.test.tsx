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

/** A 4K panel on its side at density 1.2, whose window is itself. */
const SIDEWAYS: Display = {
  name: "sideways",
  position: [0, 0],
  scale: 2,
  scanout: { size: [3840, 2160], transform: "rotate-270" },
  size: [1800, 3200],
};

/**
 * The monitor beside it, as a window on {@link SIDEWAYS} is told about it:
 * where it is relative to this window's own display, and not this window.
 */
const BESIDE_SIDEWAYS: Display = {
  name: "beside",
  position: [1800, 0],
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

  it("lays a region that is a whole window out as it is, upright and logical", () => {
    // The tty case. The engine opens a browser window per CRTC and each is
    // told one display at the origin -- and the ENGINE turns and scales that
    // window, so a 4K panel on its side at density 1.2 is a page 1800x3200
    // CSS pixels big, the right way up. A region over it is the display's own
    // rectangle and nothing more: a transform here would turn it twice, and
    // would leave everything a shell puts outside a region -- a portal, a
    // dialog -- the other way round from everything inside one.
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

  it("draws nothing on a desk where another display is this window", () => {
    // A DESK OF SEVERAL MONITORS IS SEVERAL PAGES, and each of them is told
    // the whole desk so a shell can decide things about it -- which screen the
    // chrome goes on, where a box across every screen is. What a page may
    // DRAW on is still the one monitor its window covers, so a region for any
    // other display is a claim nobody can honor: it lands on top of this
    // monitor, because a window's page has no coordinates outside itself.
    //
    // The cost of getting this wrong is not a misplaced region. Every page
    // draws the whole chrome and embeds every window, and a client's frame
    // sink takes ONE parent -- so the last page to embed takes the window off
    // all the others, and a terminal answers the keyboard while drawing
    // nothing.
    on([SIDEWAYS, BESIDE_SIDEWAYS], <Screen name="beside">stuff</Screen>);
    expect(screen.queryByText("stuff")).not.toBeInTheDocument();
  });

  it("draws once on a desk of several when one of them is this window", () => {
    // `everywhere` means every screen of the desktop, and on a desk of windows
    // the page it is asked of is one of them. The other monitors have pages of
    // their own, each rendering this same tree, so the clock a shell asks for
    // on every screen is on every screen -- once each.
    on([SIDEWAYS, BESIDE_SIDEWAYS], <Screen everywhere>clock</Screen>);
    expect(screen.getAllByText("clock")).toHaveLength(1);
    expect(regions()).toEqual(["0px,0px+1800pxx3200px"]);
  });

  it("still asks a `match` about the display this window is", () => {
    // The window's own display is not exempt from the selection, only from
    // being one of several: a shell that puts its chrome on the first screen
    // asks exactly this question, and the page whose window is the second
    // screen has to be told no.
    on(
      [SIDEWAYS, BESIDE_SIDEWAYS],
      <Screen match={(d) => d.scale > 2}>bar</Screen>,
    );
    expect(screen.queryByText("bar")).not.toBeInTheDocument();
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
