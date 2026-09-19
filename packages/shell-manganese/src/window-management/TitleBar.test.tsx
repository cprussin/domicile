import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fireEvent, render, within } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { TitleBar } from "./TitleBar";

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
  onReach: () => undefined,
  rect: ON_SCREEN,
  title: "kitty",
  window: "app:term",
} as const;

/** The Close on one of these bars, which every case here renders two of. */
const closeOn = (container: HTMLElement): HTMLElement =>
  within(container).getByRole("button", { name: "Close" });

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

  // The window it names is going, and its Close does nothing now: a control
  // the keyboard can still reach for a fifth of a second is not one.
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

  it("draws the buttons on a filled bar in the color that fill is for", () => {
    // The focused bar is filled with the accent, and the library's quiet
    // control draws its icon in `muted` — a gray nobody can find on it. The
    // color the accent is designed against is the page's `background`, which
    // is what the title beside the buttons is already drawn in.
    //
    // Declarations rather than class names, because Panda hashes them.
    const filled = render(<TitleBar {...barProps} focus="focused" />);
    expect(closeOn(filled.container).className).toContain(
      css({ color: "background" }),
    );

    // And every other bar keeps the quiet one, which is what a control on a
    // card-colored bar should be.
    const resting = render(<TitleBar {...barProps} />);
    expect(closeOn(resting.container).className).not.toContain(
      css({ color: "background" }),
    );
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
