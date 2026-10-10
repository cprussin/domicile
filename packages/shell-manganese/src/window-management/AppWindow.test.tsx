import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  APP_FOCUS_REQUESTED_EVENT,
  APP_TAG_NAME,
} from "@domicile-desktop/sdk/app-element";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { fireEvent, render } from "@testing-library/react";

import { css } from "../../styled-system/css";
import { token } from "../../styled-system/tokens";
import { AppWindow } from "./AppWindow";
import { recordedSettles } from "./recorded-settles";

// Records `focusApp` calls. Pointer mapping is the engine's, checked by
// `guard-app-routes-input.sh`.
const host = new FakeDomicileHost();

/** The windows this case asked the host to focus. */
const focused = (): unknown[] =>
  host.calls.filter(([method]) => method === "focusApp").map(([, id]) => id);

/** Where this case told the host each window is. */
const placed = (): unknown[] =>
  host.calls
    .filter(([method]) => method === "setAppBounds")
    .map(([, id, x, y, width, height]) => [id, { height, width, x, y }]);

/** An arbitrary on-screen box. */
const ON_SCREEN = { height: 800, width: 1200, x: 0, y: 32 };

/** What a window off screen reports. */
const NO_BOX = { height: 0, width: 0, x: 0, y: 0 };

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
});

describe("AppWindow", () => {
  it("leaves its frame the resting color even while it is focused", () => {
    // Focus is shown by a glow around the window (see `FocusGlow`), not a
    // border.
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

  it("answers a click on the window itself rather than letting the engine", () => {
    // The shell owns focus. If the engine moved the keyboard, the shell would
    // still draw the previous window as focused.
    const { container } = render(
      <AppWindow {...windowProps} focused={false} />,
    );

    // What the engine dispatches for a press, and grants if it stands.
    const stood = portal(container).dispatchEvent(
      new CustomEvent(APP_FOCUS_REQUESTED_EVENT, {
        bubbles: true,
        cancelable: true,
        detail: { appId: "term" },
      }),
    );

    // Focus moves only when the `focused` prop changes.
    expect(stood).toBe(false);
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

  // An empty box tells the compositor to stop the client drawing.
  it("tells the compositor a window off screen has no box", () => {
    const { rerender } = render(<AppWindow {...windowProps} focused={false} />);
    rerender(<AppWindow {...windowProps} focused={false} rect={undefined} />);

    expect(placed()).toStrictEqual([
      ["term", ON_SCREEN],
      ["term", NO_BOX],
    ]);
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

    // Resizing the box every frame would have the client draw at every size
    // in between; see `useSettling`.
    it("takes its new box at once, and eases into it from the old one", () => {
      const { played, settler } = recordedSettles();
      const { container, rerender } = render(
        <AppWindow {...windowProps} focused={false} settler={settler} />,
      );

      rerender(
        <AppWindow
          {...windowProps}
          focused={false}
          rect={{ ...ON_SCREEN, width: 600 }}
          settler={settler}
        />,
      );

      expect(
        globalThis.getComputedStyle(portal(container)).transition,
      ).not.toContain("inline-size");
      expect(played).toStrictEqual([{ scaleX: 2, scaleY: 1, x: 600, y: 0 }]);
    });

    // `scale` applies outside the motion's `transform`, so it would scale the
    // motion's travel and pull the contents off their title bar.
    it("takes its new box without easing while it plays a motion", () => {
      const { played, settler } = recordedSettles();
      const { rerender } = render(
        <AppWindow
          {...windowProps}
          focused={false}
          motion="opening"
          settler={settler}
        />,
      );

      rerender(
        <AppWindow
          {...windowProps}
          focused={false}
          motion="opening"
          rect={{ ...ON_SCREEN, x: 40 }}
          settler={settler}
        />,
      );

      expect(played).toStrictEqual([undefined]);
    });

    // Its title bar's transitions take the shortest duration then.
    it("eases as briefly as reduced motion asks", () => {
      document.documentElement.toggleAttribute("data-reduced-motion", true);
      const { container, rerender } = render(
        <AppWindow {...windowProps} focused={false} />,
      );

      rerender(
        <AppWindow
          {...windowProps}
          focused={false}
          rect={{ ...ON_SCREEN, x: 40 }}
        />,
      );
      document.documentElement.toggleAttribute("data-reduced-motion", false);

      expect(
        portal(container).getAnimations()[0]?.effect?.getTiming().duration,
      ).toBe(Number.parseInt(token("durations.fastest"), 10));
    });

    it("follows the pointer exactly while it is being dragged", () => {
      // Easing would make the window trail the pointer.
      const { played, settler } = recordedSettles();
      const { rerender } = render(
        <AppWindow
          {...windowProps}
          dragging
          focused={false}
          settler={settler}
        />,
      );

      rerender(
        <AppWindow
          {...windowProps}
          dragging
          focused={false}
          rect={{ ...ON_SCREEN, x: 40 }}
          settler={settler}
        />,
      );

      expect(played).toStrictEqual([undefined]);
    });

    it("stays opaque while it is being dragged", () => {
      const { container } = render(
        <AppWindow {...windowProps} dragging focused={false} />,
      );

      // Unset, so it draws at full opacity.
      expect(globalThis.getComputedStyle(portal(container)).opacity).toBe("");
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
