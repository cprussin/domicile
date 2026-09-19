import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { APP_TAG_NAME } from "@domicile/chrome-sdk/app-element";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Measure } from "@domicile/chrome-sdk/measure";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import { fireEvent, render } from "@testing-library/react";

import { AppWindow } from "./AppWindow";

// The SDK reports each window's size to a client, asks it for the keyboard when
// a window is clicked, and forwards the pointer over one in the client's own
// coordinates. What is read here is only the keyboard: whether it moved, and on
// whose say-so. The pointer mapping is the SDK's own and is tested there.
let focused: string[] = [];

const recordingDomicile = {
  focusApp: (appId: string) => {
    focused.push(appId);
  },
  focusChrome: () => undefined,
  // Recorded only so a click does not throw out of the SDK's own handler: the
  // button belongs to the client, and nothing here asserts on it.
  //
  // `key` is here for the same reason and one more: `registerElements` puts a
  // listener on the *document*, and the focus it forwards from is module
  // state, so a window left focused here is one a later test file's keystroke
  // is forwarded to. Without this that keystroke throws out of a handler in
  // another suite entirely.
  key: () => undefined,
  pointerButton: () => undefined,
  pointerMotion: () => undefined,
  resizeApp: () => undefined,
  surfaceSizeOf: () => undefined,
} as unknown as DomicileClient;

// The test DOM performs no layout, so measurement is injected.
const stubMeasure: Measure = () => ({
  size: [100, 100],
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
});

const noHover = () => {
  // Nothing in the case moves the pointer into the window.
};

/** Where a window on screen is, which no case here is about. */
const ON_SCREEN = { height: 800, width: 1200, x: 0, y: 32 };

/** The whole box its bar and its contents span, which it turns about. */
const FRAME = { height: 830, width: 1200, x: 0, y: 2 };

const nothingEnded = () => {
  // Nothing in the case plays an animation to its end.
};

/** The props every case here shares; each overrides the one it is about. */
const windowProps = {
  appId: "term",
  clickThrough: false,
  cursor: undefined,
  depth: 0,
  domicile: recordingDomicile,
  dragging: false,
  frame: FRAME,
  hasKeyboard: false,
  motion: "resting",
  onHover: noHover,
  onMotionEnded: nothingEnded,
  rect: ON_SCREEN,
} as const;

const noReach = () => {
  // Nothing in the case reaches for the window.
};

// The real stylesheet, because what a window's arrival and its settling
// resolve to is decided by the emitted CSS rather than by any one `css(...)`
// call: a className on its own says nothing about the rule behind it.
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

const portal = (container: HTMLElement): Element => {
  const element = container.querySelector(APP_TAG_NAME);
  if (element === null) {
    throw new Error("test: the app window rendered no element");
  } else {
    return element;
  }
};

beforeEach(() => {
  focused = [];
  registerElements(recordingDomicile, {
    measure: stubMeasure,
    // Otherwise these suites run the SDK's own animation loop, which happy-dom
    // serves as fast as it can: every mounted window re-measured tens of
    // thousands of times a second, for the length of every `await`.
    observePlacement: () => () => {
      // Never turned: nothing here tests what happens when a window moves.
    },
  });
});

describe("AppWindow", () => {
  it("mounts an element carrying the host's app id", () => {
    const { container } = render(
      <AppWindow {...windowProps} focused onReach={noReach} />,
    );
    expect(portal(container).getAttribute("app-id")).toBe("term");
  });

  it("answers a click on the window itself rather than letting the SDK", () => {
    // The SDK focuses a clicked client unless something says otherwise, and
    // this shell says otherwise: which window the user is working in is one
    // fact, and it has one owner. Left to the SDK the keyboard would move
    // while the desktop went on drawing the window before it as focused — the same
    // split a browser window had before `onReach`.
    const reached: string[] = [];
    const { container } = render(
      <AppWindow
        {...windowProps}
        focused={false}
        onReach={() => {
          reached.push("term");
        }}
      />,
    );

    portal(container).dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
    );

    expect(reached).toStrictEqual(["term"]);
    // And the SDK did not take the keyboard on its own account. It moves when
    // the shell says so, which is the `focused` prop coming back.
    expect(focused).toStrictEqual([]);
  });

  it("reports a click in the window it is already in", async () => {
    // Focus follows the cursor here, so the window under the pointer is the
    // one being worked in before the press lands — and a window that answered
    // only presses in a window it was not already in could never be raised by
    // a click. What keeps that from re-rendering the desktop on every press is
    // the reduction, which returns the state it was given when a reach moves
    // nothing.
    await new Promise<void>((resolve) => {
      const { container } = render(
        <AppWindow
          {...windowProps}
          focused
          onReach={() => {
            resolve();
          }}
        />,
      );

      portal(container).dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
  });

  it("reports the window the pointer moves into", async () => {
    // Focus follows the cursor: the window under the pointer is the window
    // the keyboard is in, and this element is where the page hears that the
    // pointer arrived — the client behind it is sent the same motion by the
    // SDK, which is a different question with the same answer.
    await new Promise<void>((resolve) => {
      const { container } = render(
        <AppWindow
          {...windowProps}
          focused={false}
          onHover={() => {
            resolve();
          }}
          onReach={noReach}
        />,
      );

      portal(container).dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true }),
      );
    });
  });

  it("hides the element when the window is not on screen", () => {
    const { container } = render(
      <AppWindow
        {...windowProps}
        focused={false}
        onReach={noReach}
        rect={undefined}
      />,
    );
    expect(portal(container)).not.toBeVisible();
  });

  it("gives the keyboard to the window the shell says is focused", () => {
    // Without a click: the user types into what they just opened, switched to,
    // or brought to the front. The shell names one window and this is what
    // carries that to the compositor — and to the SDK, which is what routes the
    // keystrokes that follow.
    render(<AppWindow {...windowProps} focused onReach={noReach} />);
    expect(focused).toStrictEqual(["term"]);
  });

  it("says nothing while the window already has the keyboard", () => {
    // The compositor answers every `focusApp` with a `focus_changed` saying it
    // carried it out, and a window that asked again on the strength of that
    // would ask for ever.
    render(
      <AppWindow {...windowProps} focused hasKeyboard onReach={noReach} />,
    );
    expect(focused).toStrictEqual([]);
  });

  it("says so again when the keyboard has gone somewhere else", () => {
    // The shell's idea of the active window and the compositor's seat are two
    // facts and they come apart: a press on the bar, on the wallpaper, on any
    // of the chrome hands the keyboard back to the page without the window the
    // user is working in having changed. Nothing else the shell watches moves,
    // so before this the desktop went on drawing a window as focused that every
    // keystroke was missing.
    const { rerender } = render(
      <AppWindow {...windowProps} focused hasKeyboard onReach={noReach} />,
    );
    // What the window asked for on the way in is not what this is about.
    focused = [];

    rerender(
      <AppWindow
        {...windowProps}
        focused
        hasKeyboard={false}
        onReach={noReach}
      />,
    );

    expect(focused).toStrictEqual(["term"]);
  });

  it("does not ask for the keyboard for a window the shell has not named", () => {
    // Only that way round: "this window has it" is an instruction the compositor
    // can carry out and "this window does not" is not one, so an unfocused
    // window says nothing rather than handing the keyboard back.
    render(<AppWindow {...windowProps} focused={false} onReach={noReach} />);
    expect(focused).toStrictEqual([]);
  });

  it("shows the cursor the client asked for", () => {
    // Ordinary CSS on an element this shell owns, which is what a cursor always
    // was — the SDK used to write it only because it owned the element class.
    const { container } = render(
      <AppWindow
        {...windowProps}
        cursor="text"
        focused={false}
        onReach={noReach}
      />,
    );
    expect(portal(container)).toHaveStyle({ cursor: "text" });
  });

  describe("the way it moves", () => {
    it("plays the motion it is given", () => {
      // A transform rather than the box, so the client is not reconfigured on
      // every frame of it — see the keyframes in `panda.config.ts`.
      const { container } = render(
        <AppWindow
          {...windowProps}
          focused={false}
          motion="opening"
          onReach={noReach}
        />,
      );

      expect(
        globalThis.getComputedStyle(portal(container)).animation,
      ).toContain("windowOpening");
    });

    // A WINDOW TURNS ABOUT ONE POINT, NOT TWO. Its contents and the bar above
    // them are separate elements, and each scaled about its own centre would
    // pull away from the other by a fraction of the window's height.
    it("turns about the middle of its whole frame rather than its own", () => {
      const { container } = render(
        <AppWindow
          {...windowProps}
          focused={false}
          motion="opening"
          onReach={noReach}
        />,
      );

      // The frame's middle is (600, 417), which is 385 above the top of the
      // contents at y = 32.
      expect(portal(container)).toHaveStyle({
        transformOrigin: "600px 385px",
      });
    });

    it("eases to a new box rather than jumping to it", () => {
      const { container } = render(
        <AppWindow {...windowProps} focused={false} onReach={noReach} />,
      );

      expect(
        globalThis.getComputedStyle(portal(container)).transition,
      ).toContain("inline-size");
    });

    it("follows the pointer exactly while it is being dragged", () => {
      // A drag writes a new box on every pointer move, and a window easing
      // towards each of them trails the pointer instead of following it.
      const { container } = render(
        <AppWindow
          {...windowProps}
          dragging
          focused={false}
          onReach={noReach}
        />,
      );

      expect(
        globalThis.getComputedStyle(portal(container)).transition,
      ).not.toContain("inline-size");
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
            onReach={noReach}
          />,
        );
        fireEvent.animationEnd(portal(container));
      });
    });
  });

  // A WINDOW ON ITS WAY OUT ASKS FOR NOTHING AND ANSWERS NOTHING. The keyboard
  // has moved on to whatever is left, and a window still asking for it would
  // take it back from the window the user is now working in.
  describe("while it is leaving", () => {
    it("does not ask for the keyboard it had", () => {
      render(
        <AppWindow
          {...windowProps}
          focused
          motion="closing"
          onReach={noReach}
        />,
      );

      expect(focused).toStrictEqual([]);
    });

    it("takes no pointer, and is nothing a keyboard can reach", () => {
      const { container } = render(
        <AppWindow
          {...windowProps}
          focused={false}
          motion="leaving-to-start"
          onReach={noReach}
        />,
      );

      expect(globalThis.getComputedStyle(portal(container)).pointerEvents).toBe(
        "none",
      );
      expect(portal(container)).toHaveAttribute("inert");
    });
  });
});
