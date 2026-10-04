import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fireEvent, render } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { TitleBar } from "./TitleBar";
import { Layout } from "./tree/node";

// The real stylesheet, because what a bar's arrival and its settling resolve
// to is decided by the emitted CSS rather than by any one `css(...)` call: a
// className on its own says nothing about the rule behind it.
//
// The layers come off first: happy-dom drops `@layer` blocks whole, and Panda
// emits everything inside them. `@media all` keeps the braces balanced and
// matches unconditionally, and the layers are emitted weakest-first, so plain
// source order lands on the same winner the cascade would.
const stylesheet = document.createElement("style");
stylesheet.textContent = readFileSync(
  new URL("../../styled-system/styles.css", import.meta.url),
  "utf8",
)
  .replaceAll(/@layer [^;{]+;/g, "")
  .replaceAll(/@layer [^{]+\{/g, "@media all{");
document.head.append(stylesheet);

/** Where a window's bar on screen is, which no case here is about. */
const ON_SCREEN = { height: 30, width: 1200, x: 0, y: 32 };

/** The whole box the window it names spans, which it turns about. */
const FRAME = { height: 830, width: 1200, x: 0, y: 32 };

const nothingEnded = () => {
  // Nothing in the case plays an animation to its end.
};

/** The props every case here shares; each overrides the one it is about. */
const barProps = {
  depth: 0,
  dragging: false,
  focus: "resting",
  frame: FRAME,
  fullscreen: false,
  motion: "resting",
  onClose: () => undefined,
  onFullscreen: () => undefined,
  onMotionEnded: nothingEnded,
  rect: ON_SCREEN,
  title: "kitty",
  window: "app:term",
} as const;

const bar = (container: HTMLElement): HTMLElement => {
  const element = container.querySelector<HTMLElement>("[data-window]");
  if (element === null) {
    throw new Error("test: the title bar rendered no element");
  } else {
    return element;
  }
};

// A window is two elements — the bar and the contents under it — so a bar that
// arrived or settled differently from the window it names would be a frame
// coming apart at the seam.
describe("TitleBar", () => {
  it("plays the motion the window it names is playing", () => {
    const { container } = render(<TitleBar {...barProps} motion="opening" />);

    expect(globalThis.getComputedStyle(bar(container)).animation).toContain(
      "windowOpening",
    );
  });

  it("turns about the middle of that window rather than its own", () => {
    const { container } = render(<TitleBar {...barProps} motion="opening" />);

    // The frame's middle is (600, 447), which is 415 below the top of the bar.
    expect(bar(container)).toHaveStyle({ transformOrigin: "600px 415px" });
  });

  // A tab closes up along the strip it is in, which is the bar's to say: the
  // contents under a shown tab play the same keyframes and only fade.
  it("closes up across a tabbed container's strip", () => {
    const { container } = render(
      <TitleBar {...barProps} motion="closing-tab" tabbed={Layout.Tabbed} />,
    );

    expect(globalThis.getComputedStyle(bar(container)).animation).toContain(
      "windowClosingTab",
    );
    expect(bar(container).style.getPropertyValue("--collapse-x")).toBe("0");
  });

  // the keyboard can still reach for a moment is not one.
  it("is nothing a pointer or a keyboard can reach while it leaves", () => {
    const { container } = render(<TitleBar {...barProps} motion="closing" />);

    expect(globalThis.getComputedStyle(bar(container)).pointerEvents).toBe(
      "none",
    );
    expect(bar(container)).toHaveAttribute("inert");
  });

  it("says when it has played that motion out", async () => {
    await new Promise<void>((resolve) => {
      const { container } = render(
        <TitleBar
          {...barProps}
          motion="closing"
          onMotionEnded={() => {
            resolve();
          }}
        />,
      );
      fireEvent.animationEnd(bar(container));
    });
  });

  it("eases to a new box rather than jumping to it", () => {
    const { container } = render(<TitleBar {...barProps} />);

    expect(globalThis.getComputedStyle(bar(container)).transition).toContain(
      "inline-size",
    );
  });

  it("follows the pointer exactly while its window is being dragged", () => {
    // A floating window is dragged by this bar, and a bar easing towards each
    // box the drag writes is one that trails the pointer holding it. Only the
    // box: the colors below still ease, because a drag is when the pointer
    // crosses the most windows.
    const { container } = render(<TitleBar {...barProps} dragging />);

    const { transition } = globalThis.getComputedStyle(bar(container));
    expect(transition).not.toContain("inline-size");
    expect(transition).toContain("background-color");
  });

  // Focus follows the cursor here, so these colors change as often as the
  // pointer crosses a window: bars that snapped between them would flicker
  // across the desktop on the way to anywhere.
  it("eases between the colors that say where the keyboard is", () => {
    const { container } = render(<TitleBar {...barProps} />);

    const { transition } = globalThis.getComputedStyle(bar(container));
    expect(transition).toContain("background-color");
    expect(transition).toContain("border-color");
    expect(transition).toContain("color");
  });

  it("sets the name of the window being worked in in a heavier face", () => {
    // The other half of standing out, and the half that survives a user who
    // cannot tell the accent from the card.
    const focused = render(<TitleBar {...barProps} focus="focused" />);
    expect(bar(focused.container).className).toContain(
      css({ fontWeight: "medium" }),
    );

    const resting = render(<TitleBar {...barProps} />);
    expect(bar(resting.container).className).not.toContain(
      css({ fontWeight: "medium" }),
    );
  });

  it("grounds the bar being worked in in the card, and sinks the rest below it", () => {
    // The card is the address bar's ground, so the focused bar reads as the
    // top of the window under it; the rest recede towards the desktop.
    const focused = render(<TitleBar {...barProps} focus="focused" />);
    expect(bar(focused.container).className).toContain(
      css({ backgroundColor: "card" }),
    );

    const resting = render(<TitleBar {...barProps} />);
    expect(bar(resting.container).className).not.toContain(
      css({ backgroundColor: "card" }),
    );
  });

  it("lifts a tab that is not open under the pointer, and no other bar", () => {
    // A hidden tab is a thing to click; an open tab or a window's own bar
    // already shows what clicking it would.
    const lift = css({
      _hover: {
        backgroundColor:
          "color-mix(in oklab, {colors.card} 50%, {colors.background})",
        color: "foreground",
      },
    });

    const hidden = render(<TitleBar {...barProps} tabbed={Layout.Tabbed} />);
    expect(bar(hidden.container).className).toContain(lift);

    const open = render(
      <TitleBar {...barProps} focus="selected" tabbed={Layout.Tabbed} />,
    );
    expect(bar(open.container).className).not.toContain(lift);

    const own = render(<TitleBar {...barProps} />);
    expect(bar(own.container).className).not.toContain(lift);
  });

  it("draws no bar's edge in the accent, whatever it says about the keyboard", () => {
    // The window the keyboard is in is picked out by the others receding —
    // see `Scrim` — rather than by a line around it.
    for (const focus of ["focused", "leaf", "resting", "selected"] as const) {
      const { container } = render(<TitleBar {...barProps} focus={focus} />);

      expect(bar(container).className).toContain(
        css({ borderColor: "borderStrong" }),
      );
    }
  });

  it("washes the keyboard's own bar in the accent inside a selected group", () => {
    // Every bar of the group is raised to the card, so the card alone would
    // not set this one apart.
    const { container } = render(<TitleBar {...barProps} focus="leaf" />);

    expect(bar(container).className).toContain(
      css({
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 45%, {colors.card})",
      }),
    );
    expect(bar(container).className).toContain(css({ fontWeight: "medium" }));
  });

  // So the edge along the top of the window the strip opens onto runs under
  // every tab.
  describe("the line under a tab its container is not showing", () => {
    const under = (props: Partial<Parameters<typeof TitleBar>[0]>) =>
      bar(
        render(<TitleBar {...barProps} tabbed={Layout.Tabbed} {...props} />)
          .container,
      );

    it("is the resting edge", () => {
      const tab = under({ besideOpenTab: true });

      expect(globalThis.getComputedStyle(tab).borderBlockEndWidth).toBe("1px");
      expect(tab.className).toContain(
        css({ borderBlockEndColor: "borderStrong" }),
      );
    });

    // But it takes the same room there, so opening a tab does not move its
    // name and buttons down by the line it lost.
    it("is not drawn under a bar that is not such a tab", () => {
      const open = under({});

      expect(globalThis.getComputedStyle(open).borderBlockEndWidth).toBe("1px");
      expect(open.className).toContain(
        css({ borderBlockEndColor: "transparent" }),
      );
    });
  });

  it("rounds its top corners, and squares them and drops its edge while its window fills the screen", () => {
    const rounded = globalThis.getComputedStyle(
      bar(render(<TitleBar {...barProps} />).container),
    );
    const square = globalThis.getComputedStyle(
      bar(render(<TitleBar {...barProps} fullscreen />).container),
    );

    expect(rounded.borderStartStartRadius).not.toBe("");
    expect(rounded.borderStartEndRadius).not.toBe("");
    expect(square.borderStartStartRadius).toBe("");
    expect(square.borderStartEndRadius).toBe("");
    expect(rounded.borderTopWidth).toBe("1px");
    expect(square.borderTopWidth).not.toBe("1px");
  });

  it("says when it is middle-clicked", async () => {
    await new Promise<void>((resolve) => {
      const { container } = render(
        <TitleBar
          {...barProps}
          onMiddleClick={() => {
            resolve();
          }}
        />,
      );
      fireEvent(
        bar(container),
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
    });
  });

  describe("the button that fills the screen", () => {
    it("asks for the window it names to fill the screen", async () => {
      await new Promise<void>((resolve) => {
        const { getByRole } = render(
          <TitleBar
            {...barProps}
            onFullscreen={() => {
              resolve();
            }}
          />,
        );
        fireEvent.click(getByRole("button", { name: "Maximize" }));
      });
    });

    it("offers the screen back once its window has it", () => {
      // The bar is still drawn over a fullscreen window, so the same button
      // is what gives the desktop back — and it has to say so.
      const { queryByRole } = render(<TitleBar {...barProps} fullscreen />);

      expect(queryByRole("button", { name: "Maximize" })).toBeNull();
      expect(queryByRole("button", { name: "Restore" })).not.toBeNull();
    });
  });
});
