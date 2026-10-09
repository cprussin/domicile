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

/** A tab's place in a strip, for cases about a tab. */
const MIDDLE_TAB = {
  divided: false,
  first: false,
  open: false,
  rest: undefined,
};

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

  // The slot is the tab's piece of the strip, which must stay whole; only the
  // tab on it opens out.
  it("opens out across a tabbed container's strip, leaving the strip whole", () => {
    const { container } = render(
      <TitleBar
        {...barProps}
        motion="opening-tab"
        strip={MIDDLE_TAB}
        tabbed={Layout.Tabbed}
      />,
    );

    expect(globalThis.getComputedStyle(bar(container)).animation).not.toContain(
      "windowOpeningTab",
    );
    expect(globalThis.getComputedStyle(face(container)).animation).toContain(
      "windowOpeningTab",
    );
  });

  it("says when its tab has opened out", async () => {
    await new Promise<void>((resolve) => {
      const { container } = render(
        <TitleBar
          {...barProps}
          motion="opening-tab"
          onMotionEnded={() => {
            resolve();
          }}
          strip={MIDDLE_TAB}
          tabbed={Layout.Tabbed}
        />,
      );
      fireEvent.animationEnd(face(container));
    });
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

  describe("a tab", () => {
    const tab = (props: Partial<Parameters<typeof TitleBar>[0]>) =>
      render(
        <TitleBar
          {...barProps}
          strip={MIDDLE_TAB}
          tabbed={Layout.Tabbed}
          {...props}
        />,
      );

    it("rounds the strip at the end it starts", () => {
      const rounded = css({ borderStartStartRadius: "lg" });

      expect(
        bar(tab({ strip: { ...MIDDLE_TAB, first: true } }).container).className,
      ).toContain(rounded);
      expect(bar(tab({}).container).className).not.toContain(rounded);
    });

    it("runs the strip on past the last tab to the strip's end", () => {
      const last = bar(tab({ strip: { ...MIDDLE_TAB, rest: 300 } }).container);

      expect(last.style.getPropertyValue("--strip-rest")).toBe("300px");
      expect(last).toHaveAttribute("data-strip-end");
      expect(bar(tab({}).container)).not.toHaveAttribute("data-strip-end");
    });

    it("draws the window's top edge along the strip, broken only by the open tab", () => {
      const line = css({ borderBlockEndWidth: "1px" });
      const overLine = css({ marginBlockEnd: "-1px" });

      const hidden = tab({});
      expect(bar(hidden.container).className).toContain(line);
      expect(bar(hidden.container).className).toContain(
        css({ borderColor: "borderStrong" }),
      );
      expect(face(hidden.container).className).not.toContain(overLine);

      const open = tab({ strip: { ...MIDDLE_TAB, open: true } });
      expect(face(open.container).className).toContain(overLine);
    });

    it("marks off a hidden tab from the hidden tab before it", () => {
      expect(
        bar(tab({ strip: { ...MIDDLE_TAB, divided: true } }).container),
      ).toHaveAttribute("data-divided");
      expect(bar(tab({}).container)).not.toHaveAttribute("data-divided");
    });

    it("offers only to close while hidden, keeping room for its title", () => {
      const hidden = tab({});
      expect(hidden.queryByRole("button", { name: "Close" })).not.toBeNull();
      expect(hidden.queryByRole("button", { name: "Maximize" })).toBeNull();
      expect(hidden.queryByRole("button", { name: "Float" })).toBeNull();

      const open = tab({ strip: { ...MIDDLE_TAB, open: true } });
      expect(open.queryByRole("button", { name: "Maximize" })).not.toBeNull();
      expect(open.queryByRole("button", { name: "Float" })).not.toBeNull();
    });

    it("shows the layout and size of a group it stands for", () => {
      const { getByRole } = tab({
        group: { layout: Layout.SplitV, windows: 3 },
      });

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
