import { describe, expect, it } from "bun:test";
import { loadEmittedStylesheet } from "@domicile-desktop/test-support/emitted-stylesheet";
import { render } from "@testing-library/react";
import { TabEdge } from "./TabEdge";
import { movingStyles } from "./window-styles";

// Loads the real stylesheet so motion styles resolve.
loadEmittedStylesheet(
  document,
  new URL("../styled-system/styles.css", import.meta.url),
);

/** A tab's contents under its strip. */
const RECT = { height: 800, width: 1200, x: 20, y: 52 };
const FRAME = { height: 832, width: 1200, x: 20, y: 20 };
const TAB = { height: 32, width: 300, x: 320, y: 20 };

const edgeOf = (container: HTMLElement): HTMLElement => {
  const edge = container.querySelector<HTMLElement>("[data-tab-edge]");
  if (edge === null) {
    throw new Error("test: TabEdge drew nothing");
  } else {
    return edge;
  }
};

const drawn = (motion: "closing-tab" | "opening-tab"): HTMLElement =>
  edgeOf(
    render(
      <TabEdge depth={3} frame={FRAME} motion={motion} rect={RECT} tab={TAB} />,
    ).container,
  );

describe("TabEdge", () => {
  // Drawn just before the contents at their depth, so they cover all but
  // the ring and shadow around them.
  it("lies at the contents' box and depth", () => {
    expect(drawn("opening-tab")).toHaveStyle({
      blockSize: "800px",
      inlineSize: "1200px",
      insetBlockStart: "52px",
      insetInlineStart: "20px",
      zIndex: "3",
    });
  });

  // It grows out of and shrinks into the tab with the contents.
  it("scales about the tab, as the contents do", () => {
    // The tab's middle is (470, 36), 16px above the contents' top.
    expect(drawn("closing-tab")).toHaveStyle({
      transformOrigin: "450px -16px",
    });
  });

  // A `box-shadow` animation repaints every frame on the main thread. A
  // static shadow on a layer of its own only fades and scales.
  it.each([
    ["opening-tab", "tabEdgeOpening"],
    ["closing-tab", "tabEdgeClosing"],
  ] as const)("fades as a layer while %s", (motion, name) => {
    const style = globalThis.getComputedStyle(drawn(motion));

    expect(style.animationName).toBe(name);
    expect(style.boxShadow).not.toBe("none");
  });

  // It keeps time with the contents it surrounds, delay included.
  it.each(["opening-tab", "closing-tab"] as const)(
    "keeps time with the contents while %s",
    (motion) => {
      const edge = globalThis.getComputedStyle(drawn(motion));
      const contents = document.createElement("div");
      contents.className = movingStyles({ contents: true, motion });
      document.body.append(contents);
      const moving = globalThis.getComputedStyle(contents);

      expect([
        edge.animationDelay,
        edge.animationDuration,
        edge.animationTimingFunction,
      ]).toStrictEqual([
        moving.animationDelay,
        moving.animationDuration,
        moving.animationTimingFunction,
      ]);
      contents.remove();
    },
  );

  it("takes no pointer", () => {
    expect(
      globalThis.getComputedStyle(drawn("opening-tab")).pointerEvents,
    ).toBe("none");
  });
});
