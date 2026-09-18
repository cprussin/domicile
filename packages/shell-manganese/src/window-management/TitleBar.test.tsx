import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";

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

/** The props every case here shares; each overrides the one it is about. */
const barProps = {
  depth: 0,
  dragging: false,
  focus: "resting",
  onClose: () => undefined,
  onReach: () => undefined,
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
  it("grows in with the window it names", () => {
    const { container } = render(<TitleBar {...barProps} />);

    expect(globalThis.getComputedStyle(bar(container)).animation).toContain(
      "windowOpening",
    );
  });

  it("eases to a new box rather than jumping to it", () => {
    const { container } = render(<TitleBar {...barProps} />);

    expect(globalThis.getComputedStyle(bar(container)).transition).toContain(
      "inline-size",
    );
  });

  it("follows the pointer exactly while its window is being dragged", () => {
    // A floating window is dragged by this bar, and a bar easing towards each
    // box the drag writes is one that trails the pointer holding it.
    const { container } = render(<TitleBar {...barProps} dragging />);

    expect(
      globalThis.getComputedStyle(bar(container)).transition,
    ).not.toContain("inline-size");
  });
});
