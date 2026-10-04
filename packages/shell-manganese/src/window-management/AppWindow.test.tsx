import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { APP_TAG_NAME } from "@domicile-desktop/sdk/app-element";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { Measure } from "@domicile-desktop/sdk/measure";
import { registerElements } from "@domicile-desktop/sdk/register-elements";
import { fireEvent, render } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { AppWindow } from "./AppWindow";

// Records `focusApp` calls. Pointer mapping is the SDK's and tested there.
const host = new FakeDomicileHost();

/** The windows this case asked the host to focus. */
const focused = (): unknown[] =>
  host.calls.filter(([method]) => method === "focusApp").map(([, id]) => id);

/** Where this case told the host each window is. */
const placed = (): unknown[] =>
  host.calls
    .filter(([method]) => method === "setAppBounds")
    .map(([, id, x, y, width, height]) => [id, { height, width, x, y }]);

// The test DOM performs no layout, so measurement is injected.
const stubMeasure: Measure = () => ({
  size: [100, 100],
  transform: [1, 0, 0, 1, 0, 0],
});

/** An arbitrary on-screen box. */
const ON_SCREEN = { height: 800, width: 1200, x: 0, y: 32 };

/** The box spanning title bar and contents. */
const FRAME = { height: 830, width: 1200, x: 0, y: 2 };

const nothingEnded = () => {
  // No test here needs the callback.
};

/**
 * The first duration in a `transition` or `animation` shorthand. Lets tests
 * compare durations without hard-coding them.
 */
const lengthOf = (shorthand: string): string => {
  const found = /\d+m?s/.exec(shorthand);
  if (found === null) {
    throw new Error(`test: no length in ${shorthand}`);
  } else {
    return found[0];
  }
};

/** Default props; each test overrides what it checks. */
const windowProps = {
  appId: "term",
  // Panel behavior is tested in `Shell.test.tsx`, with the launcher.
  behindPanel: false,
  clickThrough: false,
  cursor: undefined,
  depth: 0,
  domicile: host.host,
  dragging: false,
  frame: FRAME,
  fullscreen: false,
  hasKeyboard: false,
  motion: "resting",
  onMotionEnded: nothingEnded,
  rect: ON_SCREEN,
} as const;

// Loads the real stylesheet so computed styles reflect the emitted CSS.
//
// happy-dom drops `@layer` blocks, so each becomes `@media all`, which always
// matches. Panda emits layers weakest first, so source order gives the same
// cascade winner.
const stylesheet = document.createElement("style");
stylesheet.textContent = readFileSync(
  new URL("../../styled-system/styles.css", import.meta.url),
  "utf8",
)
  .replaceAll(/@layer [^;{]+;/g, "")
  .replaceAll(/@layer [^{]+\{/g, "@media all{");
document.head.append(stylesheet);

const portal = (container: HTMLElement): Element => {
  const element = container.querySelector(APP_TAG_NAME);
  if (element === null) {
    throw new Error("test: the app window rendered no element");
  } else {
    return element;
  }
};

beforeEach(() => {
  host.calls.length = 0;
  registerElements(host.host, { measure: stubMeasure });
});

describe("AppWindow", () => {
  it("leaves its frame the resting color even while it is focused", () => {
    // Focus is shown by dimming other windows (see `Scrim`), not a border.
    const { container } = render(<AppWindow {...windowProps} focused />);

    expect(portal(container).className).toContain(
      css({ borderColor: "borderStrong" }),
    );
  });

  it("rounds its bottom corners, and leaves its top ones to the bar", () => {
    const { container } = render(<AppWindow {...windowProps} focused />);
    const style = globalThis.getComputedStyle(portal(container));

    expect(style.borderEndStartRadius).not.toBe("");
    expect(style.borderEndEndRadius).not.toBe("");
    // A top radius would cut a notch under the title bar.
    expect(style.borderStartStartRadius).toBe("");
    expect(style.borderStartEndRadius).toBe("");
  });

  it("squares its corners and drops its edge while it fills the screen", () => {
    const { container } = render(
      <AppWindow {...windowProps} focused fullscreen />,
    );
    const style = globalThis.getComputedStyle(portal(container));

    expect(style.borderEndStartRadius).toBe("");
    expect(style.borderEndEndRadius).toBe("");
    // No edge at the screen border.
    expect(style.borderTopWidth).not.toBe("1px");
  });

  it("mounts an element carrying the host's app id", () => {
    const { container } = render(<AppWindow {...windowProps} focused />);
    expect(portal(container).getAttribute("app-id")).toBe("term");
  });

  it("answers a click on the window itself rather than letting the SDK", () => {
    // The shell owns focus. If the SDK moved the keyboard, the shell would
    // still draw the previous window as focused.
    const { container } = render(
      <AppWindow {...windowProps} focused={false} />,
    );

    portal(container).dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );

    // Focus moves only when the `focused` prop changes.
    expect(focused()).toStrictEqual([]);
  });

  it("hides the element when the window is not on screen", () => {
    const { container } = render(
      <AppWindow {...windowProps} focused={false} rect={undefined} />,
    );
    expect(portal(container)).not.toBeVisible();
  });

  it("gives the keyboard to the window the shell says is focused", () => {
    // Covers focus without a click, such as a newly opened or raised window.
    render(<AppWindow {...windowProps} focused />);
    expect(focused()).toStrictEqual(["term"]);
  });

  it("says nothing while the window already has the keyboard", () => {
    // Otherwise each `focus_changed` reply would trigger another request.
    render(<AppWindow {...windowProps} focused hasKeyboard />);
    expect(focused()).toStrictEqual([]);
  });

  it("says so again when the keyboard has gone somewhere else", () => {
    // A press on chrome moves the keyboard to the page without changing the
    // shell's focused window. The window must reclaim it.
    const { rerender } = render(
      <AppWindow {...windowProps} focused hasKeyboard />,
    );
    // Ignore the request made on mount.
    host.calls.length = 0;

    rerender(<AppWindow {...windowProps} focused hasKeyboard={false} />);

    expect(focused()).toStrictEqual(["term"]);
  });

  it("does not ask for the keyboard for a window the shell has not named", () => {
    // There is no "unfocus" request; the keyboard always belongs to someone.
    render(<AppWindow {...windowProps} focused={false} />);
    expect(focused()).toStrictEqual([]);
  });

  it("tells the compositor where it is each time it moves", () => {
    // The client draws at the scale of the monitor under it.
    const moved = { ...ON_SCREEN, x: 1920 };
    const { rerender } = render(<AppWindow {...windowProps} focused={false} />);
    rerender(
      <AppWindow {...windowProps} focused={false} rect={{ ...ON_SCREEN }} />,
    );
    rerender(<AppWindow {...windowProps} focused={false} rect={moved} />);

    expect(placed()).toStrictEqual([
      ["term", ON_SCREEN],
      ["term", moved],
    ]);
  });

  it("says nothing about where a window off screen is", () => {
    render(<AppWindow {...windowProps} focused={false} rect={undefined} />);

    expect(placed()).toStrictEqual([]);
  });

  it("shows the cursor the client asked for", () => {
    const { container } = render(
      <AppWindow {...windowProps} cursor="text" focused={false} />,
    );
    expect(portal(container)).toHaveStyle({ cursor: "text" });
  });

  describe("the way it moves", () => {
    it("plays the motion it is given", () => {
      // Animates a transform so the client is not resized each frame. See
      // the keyframes in `panda.config.ts`.
      const { container } = render(
        <AppWindow {...windowProps} focused={false} motion="opening" />,
      );

      expect(
        globalThis.getComputedStyle(portal(container)).animation,
      ).toContain("windowOpening");
    });

    // The contents and title bar are separate elements. Each must scale about
    // the same point or they would separate.
    it("turns about the middle of its whole frame rather than its own", () => {
      const { container } = render(
        <AppWindow {...windowProps} focused={false} motion="opening" />,
      );

      // The frame's middle is (600, 417), 385px below the contents' top at
      // y = 32.
      expect(portal(container)).toHaveStyle({
        transformOrigin: "600px 385px",
      });
    });

    // Neighbors ease into the closing window's box, so the close animation
    // must not outlast that transition.
    it("leaves in the time the layout takes to close over it", () => {
      const { container } = render(
        <AppWindow {...windowProps} focused={false} motion="closing" />,
      );
      const style = globalThis.getComputedStyle(portal(container));

      expect(lengthOf(style.animation)).toBe(lengthOf(style.transition));
    });

    it("eases to a new box rather than jumping to it", () => {
      const { container } = render(
        <AppWindow {...windowProps} focused={false} />,
      );

      expect(
        globalThis.getComputedStyle(portal(container)).transition,
      ).toContain("inline-size");
    });

    it("follows the pointer exactly while it is being dragged", () => {
      // Easing would make the window trail the pointer.
      const { container } = render(
        <AppWindow {...windowProps} dragging focused={false} />,
      );

      expect(
        globalThis.getComputedStyle(portal(container)).transition,
      ).not.toContain("inline-size");
    });

    // A drag changes opacity at both ends; snapping would look like a blink.
    it("fades to see-through as it is taken hold of", () => {
      const { container } = render(
        <AppWindow {...windowProps} dragging focused={false} />,
      );

      expect(
        globalThis.getComputedStyle(portal(container)).transition,
      ).toContain("opacity");
    });

    it("fades back to solid as it is let go", () => {
      const { container } = render(
        <AppWindow {...windowProps} focused={false} />,
      );

      expect(
        globalThis.getComputedStyle(portal(container)).transition,
      ).toContain("opacity");
    });

    it("says when it has played its motion out", async () => {
      await new Promise<void>((resolve) => {
        const { container } = render(
          <AppWindow
            {...windowProps}
            focused={false}
            motion="closing"
            onMotionEnded={() => {
              resolve();
            }}
          />,
        );
        fireEvent.animationEnd(portal(container));
      });
    });
  });

  // A leaving window must not take the keyboard back from the next window.
  describe("while it is leaving", () => {
    it("does not ask for the keyboard it had", () => {
      render(<AppWindow {...windowProps} focused motion="closing" />);

      expect(focused()).toStrictEqual([]);
    });

    it("takes no pointer, and is nothing a keyboard can reach", () => {
      const { container } = render(
        <AppWindow
          {...windowProps}
          focused={false}
          motion="leaving-to-start"
        />,
      );

      expect(globalThis.getComputedStyle(portal(container)).pointerEvents).toBe(
        "none",
      );
      expect(portal(container)).toHaveAttribute("inert");
    });
  });
});
