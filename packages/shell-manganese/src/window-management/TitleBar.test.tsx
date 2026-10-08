import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fireEvent, render } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { TitleBar } from "./TitleBar";
import { Layout } from "./tree/node";

// Loads the real stylesheet, since the computed animation depends on the
// emitted CSS, not on any one class name.
//
// happy-dom drops `@layer` blocks, so they are rewritten to `@media all`.
// Panda emits layers weakest first, so source order gives the same cascade.
const stylesheet = document.createElement("style");
stylesheet.textContent = readFileSync(
  new URL("../../styled-system/styles.css", import.meta.url),
  "utf8",
)
  .replaceAll(/@layer [^;{]+;/g, "")
  .replaceAll(/@layer [^{]+\{/g, "@media all{");
document.head.append(stylesheet);

/** An arbitrary bar position. */
const ON_SCREEN = { height: 30, width: 1200, x: 0, y: 32 };

/** The window's whole box, which the bar scales about. */
const FRAME = { height: 830, width: 1200, x: 0, y: 32 };

const nothingEnded = () => {
  // No case here plays an animation to its end.
};

/** Shared props; each case overrides the one it tests. */
const barProps = {
  depth: 0,
  dragging: false,
  floating: false,
  focus: "resting",
  frame: FRAME,
  fullscreen: false,
  motion: "resting",
  onClose: () => undefined,
  onFloat: () => undefined,
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

/** The bar's own box, inside the slot `bar` returns. */
const face = (container: HTMLElement): HTMLElement => {
  const element = container.querySelector<HTMLElement>("[data-face]");
  if (element === null) {
    throw new Error("test: the title bar rendered no face");
  } else {
    return element;
  }
};

/** The tab strip behind a container's tabs. */
const STRIP = css({
  backgroundColor:
    "color-mix(in oklab, {colors.border} 50%, {colors.background})",
});

// The bar and the contents are separate elements, so they must animate
// identically or the window splits apart.
describe("TitleBar", () => {
  it("plays the motion the window it names is playing", () => {
    const { container } = render(<TitleBar {...barProps} motion="opening" />);

    expect(globalThis.getComputedStyle(bar(container)).animation).toContain(
      "windowOpening",
    );
  });

  it("turns about the middle of that window rather than its own", () => {
    const { container } = render(<TitleBar {...barProps} motion="opening" />);

    // The frame's middle is (600, 447), 415 below the top of the bar.
    expect(bar(container)).toHaveStyle({ transformOrigin: "600px 415px" });
  });

  // A tab collapses along its strip; the contents under it only fade.
  it("closes up across a tabbed container's strip", () => {
    const { container } = render(
      <TitleBar {...barProps} motion="closing-tab" tabbed={Layout.Tabbed} />,
    );

    expect(globalThis.getComputedStyle(bar(container)).animation).toContain(
      "windowClosingTab",
    );
    expect(bar(container).style.getPropertyValue("--collapse-x")).toBe("0");
  });

  // A closing bar's buttons would do nothing.
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
    // Easing the box would make the bar trail the pointer. Colors still ease,
    // since a drag crosses many windows.
    const { container } = render(<TitleBar {...barProps} dragging />);

    const { transition } = globalThis.getComputedStyle(bar(container));
    expect(transition).not.toContain("inline-size");
    expect(transition).toContain("background-color");
  });

  // Focus follows the cursor, so these colors change often and would flicker
  // without easing.
  it("eases between the colors that say where the keyboard is", () => {
    const { container } = render(<TitleBar {...barProps} />);

    const { transition } = globalThis.getComputedStyle(face(container));
    expect(transition).toContain("background-color");
    expect(transition).toContain("border-color");
    expect(transition).toContain("color");
  });

  it("sets the name of the window being worked in in a heavier face", () => {
    // Weight as well as color, for users who cannot tell the colors apart.
    const focused = render(<TitleBar {...barProps} focus="focused" />);
    expect(face(focused.container).className).toContain(
      css({ fontWeight: "medium" }),
    );

    const resting = render(<TitleBar {...barProps} />);
    expect(face(resting.container).className).not.toContain(
      css({ fontWeight: "medium" }),
    );
  });

  it("grounds the bar being worked in in the card, and sinks the rest below it", () => {
    // The card matches the address bar's background, so the focused bar
    // reads as part of its window.
    const focused = render(<TitleBar {...barProps} focus="focused" />);
    expect(face(focused.container).className).toContain(
      css({ backgroundColor: "card" }),
    );

    const resting = render(<TitleBar {...barProps} />);
    expect(face(resting.container).className).not.toContain(
      css({ backgroundColor: "card" }),
    );
  });

  it("lifts a tab that is not open under the pointer, and no other bar", () => {
    // Only a hidden tab has anything to show by clicking.
    const lift = css({
      _hover: {
        backgroundColor:
          "color-mix(in oklab, {colors.card} 50%, {colors.background})",
        color: "foreground",
      },
    });

    const hidden = render(<TitleBar {...barProps} tabbed={Layout.Tabbed} />);
    expect(face(hidden.container).className).toContain(lift);

    const open = render(
      <TitleBar {...barProps} focus="selected" tabbed={Layout.Tabbed} />,
    );
    expect(face(open.container).className).not.toContain(lift);

    const own = render(<TitleBar {...barProps} />);
    expect(face(own.container).className).not.toContain(lift);
  });

  it("draws no bar's edge in the accent, whatever it says about the keyboard", () => {
    // The glow around the window marks focus instead. See `FocusGlow`.
    for (const focus of ["focused", "leaf", "resting", "selected"] as const) {
      const { container } = render(<TitleBar {...barProps} focus={focus} />);

      expect(face(container).className).toContain(
        css({ borderColor: "borderStrong" }),
      );
    }
  });

  it("washes the keyboard's own bar in the accent inside a selected group", () => {
    // The whole group uses the card, so the card alone would not mark this
    // one.
    const { container } = render(<TitleBar {...barProps} focus="leaf" />);

    expect(face(container).className).toContain(
      css({
        backgroundColor:
          "color-mix(in oklab, {colors.accent} 45%, {colors.card})",
      }),
    );
    expect(face(container).className).toContain(css({ fontWeight: "medium" }));
  });

  // Continues the shown window's top edge under every hidden tab.
  describe("the line under a tab its container is not showing", () => {
    const under = (props: Partial<Parameters<typeof TitleBar>[0]>) =>
      render(<TitleBar {...barProps} tabbed={Layout.Tabbed} {...props} />)
        .container;

    it("is the resting edge", () => {
      // The strip draws it under the space between tabs too.
      const tab = face(under({ besideOpenTab: true }));
      expect(bar(under({ besideOpenTab: true })).className).toContain(
        css({ borderBlockEndColor: "borderStrong" }),
      );

      expect(globalThis.getComputedStyle(tab).borderBlockEndWidth).toBe("1px");
      expect(tab.className).toContain(
        css({ borderBlockEndColor: "borderStrong" }),
      );
    });

    // It keeps the same width, so opening a tab does not shift its contents.
    it("is not drawn under a bar that is not such a tab", () => {
      const open = face(under({}));

      expect(globalThis.getComputedStyle(open).borderBlockEndWidth).toBe("1px");
      expect(open.className).toContain(
        css({ borderBlockEndColor: "transparent" }),
      );
    });
  });

  describe("a tab", () => {
    it("rests in a strip that runs between it and its neighbors", () => {
      const tab = render(<TitleBar {...barProps} tabbed={Layout.Tabbed} />);
      expect(bar(tab.container).className).toContain(STRIP);
      // Inset on top and at the sides; the bottom meets the window.
      expect(bar(tab.container).className).toContain(
        css({ paddingBlockStart: 0.75, paddingInline: 0.75 }),
      );

      const own = render(<TitleBar {...barProps} />);
      expect(bar(own.container).className).not.toContain(STRIP);
    });

    it("lights its strip, not itself, when its whole group is selected", () => {
      const { container } = render(
        <TitleBar
          {...barProps}
          focus="focused"
          groupSelected
          tabbed={Layout.Tabbed}
        />,
      );

      expect(bar(container).className).toContain(
        css({
          backgroundColor:
            "color-mix(in oklab, {colors.accent} 45%, {colors.background})",
        }),
      );
      expect(face(container).className).toContain(
        css({ backgroundColor: "card" }),
      );
    });

    it("shows the layout and size of a group it stands for", () => {
      const { getByRole } = render(
        <TitleBar
          {...barProps}
          group={{ layout: Layout.SplitV, windows: 3 }}
          tabbed={Layout.Tabbed}
        />,
      );

      expect(getByRole("img", { name: "Column of 3" }).textContent).toBe("3");
    });
  });

  it("rounds its top corners, and squares them and drops its edge while its window fills the screen", () => {
    const rounded = globalThis.getComputedStyle(
      face(render(<TitleBar {...barProps} />).container),
    );
    const square = globalThis.getComputedStyle(
      face(render(<TitleBar {...barProps} fullscreen />).container),
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
      // The bar stays over a fullscreen window, so its button restores it.
      const { queryByRole } = render(<TitleBar {...barProps} fullscreen />);

      expect(queryByRole("button", { name: "Maximize" })).toBeNull();
      expect(queryByRole("button", { name: "Restore" })).not.toBeNull();
    });
  });

  describe("the button that floats the window", () => {
    it("asks for the window it names to float, left of the fullscreen button", async () => {
      await new Promise<void>((resolve) => {
        const { getByRole } = render(
          <TitleBar
            {...barProps}
            onFloat={() => {
              resolve();
            }}
          />,
        );
        const float = getByRole("button", { name: "Float" });
        expect(
          float.compareDocumentPosition(
            getByRole("button", { name: "Maximize" }),
          ),
        ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        fireEvent.click(float);
      });
    });

    it("offers to tile a floating window", () => {
      const { queryByRole } = render(<TitleBar {...barProps} floating />);

      expect(queryByRole("button", { name: "Float" })).toBeNull();
      expect(queryByRole("button", { name: "Tile" })).not.toBeNull();
    });
  });
});
