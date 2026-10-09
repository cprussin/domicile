import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fireEvent, render } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { TitleBar } from "./TitleBar";
import type { StripPlace } from "./tree/frames";
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

/** The address bar's background, which the bar or open tab above matches. */
const RAISED =
  "color-mix(in oklab, {colors.foreground} 14%, {colors.background})";

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
  at: 1,
  divided: false,
  first: false,
  open: false,
  rest: undefined,
  tabs: 3,
};

// The bar and the contents are separate elements, so they must animate
// identically or the window splits apart.
describe("TitleBar's icon", () => {
  const icon = (container: HTMLElement): Element => {
    const element = face(container).querySelector("[data-icon]");
    if (element === null) {
      throw new Error("test: the title bar drew no icon");
    } else {
      return element;
    }
  };

  it("draws the window's icon", () => {
    const { container } = render(
      <TitleBar {...barProps} icon="data:image/png;base64,AA==" />,
    );

    expect(icon(container).querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,AA==",
    );
  });

  // Every bar has an icon, so titles line up.
  it("draws a stand-in for a window with no icon", () => {
    const { container } = render(<TitleBar {...barProps} icon={undefined} />);

    expect(icon(container).querySelector("img")).toBeNull();
    expect(icon(container).querySelector("svg")).not.toBeNull();
  });

  // A page can link an icon that does not load.
  it("draws the stand-in when the icon does not load", () => {
    const { container } = render(
      <TitleBar {...barProps} icon="https://example.com/missing.png" />,
    );
    const image = icon(container).querySelector("img");
    if (image === null) {
      throw new Error("test: the title bar drew no image");
    }

    fireEvent.error(image);

    expect(icon(container).querySelector("img")).toBeNull();
    expect(icon(container).querySelector("svg")).not.toBeNull();
  });
});

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

  it("raises the bar being worked in to the address bar, and sinks the rest below it", () => {
    // The focused bar matches the address bar, so it reads as part of its
    // window.
    const focused = render(<TitleBar {...barProps} focus="focused" />);
    expect(face(focused.container).className).toContain(
      css({ backgroundColor: RAISED }),
    );

    const resting = render(<TitleBar {...barProps} />);
    expect(face(resting.container).className).not.toContain(
      css({ backgroundColor: RAISED }),
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
    // The whole group is raised, so that alone would not mark this one.
    const { container } = render(<TitleBar {...barProps} focus="leaf" />);

    expect(face(container).className).toContain(
      css({
        backgroundColor: `color-mix(in oklab, {colors.accent} 45%, ${RAISED})`,
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

    // A tab opening or closing before the last moves the last tab's slot. The
    // rest eases with it, so the strip's end stays put.
    it("eases the strip it runs on along with its own box", () => {
      const last = bar(tab({ strip: { ...MIDDLE_TAB, rest: 300 } }).container);

      expect(stylesheet.textContent).toMatch(
        /@property --strip-rest\s*\{[^}]*syntax:\s*['"]<length>['"]/,
      );
      expect(globalThis.getComputedStyle(last).transition).toContain(
        "--strip-rest",
      );
    });

    // Each slot draws the edge as the same straight band, which every slot
    // shades alike between device pixels. The window's top row is tucked
    // under the slot's bottom row, so the open tab leaves that row to it.
    it("draws the window's top edge along the strip, broken only by the open tab", () => {
      const line = css({ borderBlockEndWidth: "1px" });
      const pastSlot = css({ insetInlineStart: "100%" });
      const leavesBottomRow = [
        css({ borderBlockEndColor: "transparent" }),
        css({ backgroundClip: "padding-box" }),
      ];
      const edge = (container: HTMLElement) =>
        bar(container).querySelector("[data-strip-edge]");

      const hidden = tab({});
      for (const style of leavesBottomRow) {
        expect(bar(hidden.container).className).toContain(style);
      }
      expect(edge(hidden.container)?.className).toContain(line);
      expect(edge(hidden.container)?.className).not.toContain(pastSlot);
      expect(bar(hidden.container).className).toContain(
        css({ "--strip-edge": "{colors.borderStrong}" }),
      );

      const open = tab({ strip: { ...MIDDLE_TAB, open: true } });
      for (const style of leavesBottomRow) {
        expect(bar(open.container).className).toContain(style);
      }
      expect(edge(open.container)?.className).toContain(pastSlot);
      expect(face(open.container).className).not.toContain(
        css({ marginBlockEnd: "-1px" }),
      );
    });

    it("raises the open tab to match the address bar it meets", () => {
      const raised = css({ backgroundColor: RAISED });

      expect(
        face(tab({ strip: { ...MIDDLE_TAB, open: true } }).container).className,
      ).toContain(raised);
      expect(face(tab({}).container).className).not.toContain(raised);
    });

    // A press on a hidden tab opens it; one on the open tab does nothing new.
    it("shows a pointer over a hidden tab but not the open one", () => {
      const cursor = (container: HTMLElement) =>
        globalThis.getComputedStyle(face(container)).cursor;

      expect(cursor(tab({}).container)).toBe("pointer");
      expect(
        cursor(tab({ strip: { ...MIDDLE_TAB, open: true } }).container),
      ).not.toBe("pointer");
    });

    describe("moved along its strip", () => {
      const SLOT = { height: 30, width: 240, x: 260, y: 32 };
      const moved = (strip: StripPlace) => {
        const props: Parameters<typeof TitleBar>[0] = {
          ...barProps,
          frame: SLOT,
          rect: SLOT,
          strip: MIDDLE_TAB,
          tabbed: Layout.Tabbed,
        };
        const rendered = render(<TitleBar {...props} />);
        rendered.rerender(
          <TitleBar
            {...props}
            rect={{ ...SLOT, x: SLOT.x + 240 * (strip.at - MIDDLE_TAB.at) }}
            strip={strip}
          />,
        );
        return rendered.container;
      };

      // Two tabs trading places would cross, opening a hole in the strip, and
      // the strip's end would move to the new last slot.
      it("moves its piece of the strip at once", () => {
        const container = moved({ ...MIDDLE_TAB, at: 2, rest: 300 });

        const { transition } = globalThis.getComputedStyle(bar(container));
        expect(transition).not.toContain("inset-inline-start");
        expect(transition).not.toContain("--strip-rest");
      });

      it("slides the tab over from where it was", () => {
        const container = moved({ ...MIDDLE_TAB, at: 2 });

        expect(
          globalThis.getComputedStyle(face(container)).animation,
        ).toContain("windowSlidingTab");
        expect(face(container).style.getPropertyValue("--slide-x")).toBe(
          "-240px",
        );
      });

      // The gap in the edge under an open tab would wait at its new place.
      it("joins its window once it is there", () => {
        const pastSlot = css({ insetInlineStart: "100%" });
        const edge = (container: HTMLElement) =>
          bar(container).querySelector("[data-strip-edge]")?.className;
        const container = moved({ ...MIDDLE_TAB, at: 2, open: true });
        expect(edge(container)).not.toContain(pastSlot);

        fireEvent.animationEnd(face(container), {
          animationName: "windowSlidingTab",
        });

        expect(edge(container)).toContain(pastSlot);
      });

      it("stops sliding once it is there", () => {
        const container = moved({ ...MIDDLE_TAB, at: 2 });

        fireEvent.animationEnd(face(container), {
          animationName: "windowSlidingTab",
        });

        expect(
          globalThis.getComputedStyle(face(container)).animation,
        ).not.toContain("windowSlidingTab");
        expect(
          globalThis.getComputedStyle(bar(container)).transition,
        ).toContain("inset-inline-start");
      });

      // A tab opening before it moves every slot after it the same way, so
      // the slots ease together and the strip stays whole.
      it("eases with the strip when a tab opens before it", () => {
        const container = moved({ ...MIDDLE_TAB, at: 2, tabs: 4 });

        expect(
          globalThis.getComputedStyle(face(container)).animation,
        ).not.toContain("windowSlidingTab");
        expect(
          globalThis.getComputedStyle(bar(container)).transition,
        ).toContain("inset-inline-start");
      });
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
