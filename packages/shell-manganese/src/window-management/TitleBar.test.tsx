import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { loadEmittedStylesheet } from "../emitted-stylesheet";
import { raised } from "./placement";
import { recordedSettles } from "./recorded-settles";
import { TitleBar } from "./TitleBar";
import type { StripPlace } from "./tree/frames";
import { Layout } from "./tree/node";

loadEmittedStylesheet(document);

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
  box: { height: 30, width: 1000, x: 0, y: 0 },
  divided: false,
  end: { height: 30, width: 280, x: 720, y: 0 },
  group: { node: { id: "a", up: 1 }, windows: ["a", "b", "c"] },
  open: false,
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

  // The tabs after it ease along on the same curve, so its end meets the next
  // tab's start throughout and the strip shows no gap.
  it.each(["closing-tab", "opening-tab", "sending-tab"] as const)(
    "turns about the start of its strip while %s",
    (motion) => {
      const { container } = render(
        <TitleBar
          {...barProps}
          motion={motion}
          strip={MIDDLE_TAB}
          tabbed={Layout.Tabbed}
        />,
      );

      expect(bar(container)).toHaveStyle({ transformOrigin: "0px 0px" });
    },
  );

  it("opens out along a tabbed container's strip", () => {
    const { container } = render(
      <TitleBar
        {...barProps}
        motion="opening-tab"
        strip={MIDDLE_TAB}
        tabbed={Layout.Tabbed}
      />,
    );

    expect(globalThis.getComputedStyle(bar(container)).animation).toContain(
      "windowOpeningTab",
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

  describe("moved to a new box", () => {
    const AWAY = { ...ON_SCREEN, x: 100 };
    const moved = (props: Partial<Parameters<typeof TitleBar>[0]>) => {
      const { kept, played, settler } = recordedSettles();
      const rendered = render(
        <TitleBar {...barProps} {...props} settler={settler} />,
      );
      rendered.rerender(
        <TitleBar
          {...barProps}
          {...props}
          frame={{ ...FRAME, x: 100 }}
          rect={AWAY}
          settler={settler}
        />,
      );
      return { container: rendered.container, kept, played };
    };

    // On the contents' timing and the compositor's thread, so the bar keeps
    // with its window.
    it("eases there as its window's contents do", () => {
      const { container, played } = moved({});

      expect(played).toStrictEqual([{ scaleX: 1, scaleY: 1, x: -100, y: 0 }]);
      expect(
        globalThis.getComputedStyle(bar(container)).transition,
      ).not.toContain("inset-inline-start");
    });

    // Easing would make the bar trail the pointer. Colors still ease, since a
    // drag crosses many windows.
    it("goes there at once while its window is being dragged", () => {
      const { container, played } = moved({ dragging: true });

      expect(played).toStrictEqual([undefined]);
      expect(globalThis.getComputedStyle(bar(container)).transition).toContain(
        "background-color",
      );
    });

    it("goes there at once while it plays a motion", () => {
      expect(moved({ motion: "opening" }).played).toStrictEqual([undefined]);
    });

    // Scaling text and icons would stretch them.
    it("keeps its title and buttons at their own size as it eases", () => {
      const upright = moved({}).kept[0] ?? [];

      expect(
        upright.some((part) => part.contains(screen.getByText("kitty"))),
      ).toBe(true);
      expect(
        upright.some((part) =>
          part.contains(screen.getByRole("button", { name: "Close" })),
        ),
      ).toBe(true);
    });
  });

  // It stays over the windows its window still covers until it has shrunk.
  it("keeps a lower depth's old one until it has settled", () => {
    const { container, rerender } = render(
      <TitleBar {...barProps} depth={2000} />,
    );
    const transition = () =>
      globalThis.getComputedStyle(bar(container)).transition;
    expect(transition()).not.toContain("z-index");

    rerender(<TitleBar {...barProps} depth={0} />);

    expect(transition()).toContain("z-index");
    expect(transition()).toContain("step-end");
  });

  it("shows a grabbing pointer while its window is being dragged", () => {
    const { container } = render(<TitleBar {...barProps} dragging />);

    expect(globalThis.getComputedStyle(bar(container)).cursor).toBe("grabbing");
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

    // The strip draws the window's top edge along its bottom row. The open
    // tab covers it there to join its window; a stack's bars sit over each
    // other, not over the window.
    it("covers the strip's bottom edge only where it is the open tab", () => {
      const covers = css({ marginBlockEnd: "-1px" });

      expect(
        face(tab({ strip: { ...MIDDLE_TAB, open: true } }).container).className,
      ).toContain(covers);
      expect(face(tab({}).container).className).not.toContain(covers);
      expect(
        face(
          tab({
            strip: { ...MIDDLE_TAB, open: true },
            tabbed: Layout.Stacking,
          }).container,
        ).className,
      ).not.toContain(covers);
    });

    it("raises the open tab to match the address bar it meets", () => {
      const raised = css({ backgroundColor: RAISED });

      expect(
        face(tab({ strip: { ...MIDDLE_TAB, open: true } }).container).className,
      ).toContain(raised);
      expect(face(tab({}).container).className).not.toContain(raised);
    });

    // Swapped tabs slide past each other. The open tab slides over its
    // neighbors, whose pieces of the strip would otherwise cover it.
    it("draws the open tab over the rest of its strip", () => {
      const depth = (strip: StripPlace) =>
        bar(tab({ depth: 2, strip }).container).style.zIndex;

      expect(depth({ ...MIDDLE_TAB, open: true })).toBe(raised(2).toString());
      expect(depth(MIDDLE_TAB)).toBe("2");
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

  // A scratchpad window hangs from the screen's top edge.
  it("squares its top corners but keeps its edge while its window hangs", () => {
    const style = globalThis.getComputedStyle(
      face(render(<TitleBar {...barProps} hanging />).container),
    );

    expect(style.borderStartStartRadius).toBe("");
    expect(style.borderStartEndRadius).toBe("");
    expect(style.borderTopWidth).toBe("1px");
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

  // A press reaching the window frame selects the window, which would open a
  // hidden tab for an instant before the click closes it.
  it("keeps a middle press from the window around it", () => {
    const onReach = mock(() => undefined);
    const { container } = render(
      <div onPointerDown={onReach}>
        <TitleBar {...barProps} strip={MIDDLE_TAB} />
      </div>,
    );

    fireEvent.pointerDown(bar(container), { button: 1, pointerId: 1 });

    expect(onReach).not.toHaveBeenCalled();
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
