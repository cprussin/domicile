import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

import { ClosingWindow } from "./ClosingWindow";
import type { Placement } from "./placement";

/** Where the window was when it closed. */
const WAS: Placement = {
  bar: { height: 30, width: 1200, x: 0, y: 32 },
  depth: 2,
  id: "app:term",
  surface: { height: 770, width: 1200, x: 0, y: 62 },
};

const nothingLeft = () => {
  // Nothing in the case waits for the window to finish leaving.
};

const boxOf = (element: Element): Record<string, string> => {
  const { style } = element as HTMLElement;
  return {
    blockSize: style.blockSize,
    inlineSize: style.inlineSize,
    insetBlockStart: style.insetBlockStart,
    insetInlineStart: style.insetInlineStart,
    zIndex: style.zIndex,
  };
};

describe("ClosingWindow", () => {
  it("goes on saying which window it was", () => {
    render(
      <ClosingWindow onGone={nothingLeft} placement={WAS} title="kitty" />,
    );

    expect(screen.getByText("kitty")).toBeInTheDocument();
  });

  it("plays out at the box the window had, bar and contents alike", () => {
    const { container } = render(
      <ClosingWindow onGone={nothingLeft} placement={WAS} title="kitty" />,
    );
    const [bar, contents] = [...container.children];

    expect(boxOf(bar as Element)).toStrictEqual({
      blockSize: "30px",
      inlineSize: "1200px",
      insetBlockStart: "32px",
      insetInlineStart: "0px",
      zIndex: "2",
    });
    expect(boxOf(contents as Element)).toStrictEqual({
      blockSize: "770px",
      inlineSize: "1200px",
      insetBlockStart: "62px",
      insetInlineStart: "0px",
      zIndex: "2",
    });
  });

  // A window a tabbed container was not showing had no contents on screen to
  // take away: its tab is the whole of what leaves.
  it("is a bar alone for a window whose contents were behind a tab", () => {
    const { container } = render(
      <ClosingWindow
        onGone={nothingLeft}
        placement={{ ...WAS, surface: undefined }}
        title="kitty"
      />,
    );

    expect(container.children).toHaveLength(1);
  });

  it("says when it has finished leaving", async () => {
    await new Promise<void>((resolve) => {
      const { container } = render(
        <ClosingWindow
          onGone={() => {
            resolve();
          }}
          placement={WAS}
          title="kitty"
        />,
      );
      const bar = container.firstElementChild;
      if (bar === null) {
        throw new Error("the closing window drew nothing");
      } else {
        fireEvent.animationEnd(bar);
      }
    });
  });
});
