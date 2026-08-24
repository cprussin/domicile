import { describe, expect, it } from "bun:test";

import type { TerminalBridge } from "./terminal-shortcut";
import { openTerminalOnAltEnter } from "./terminal-shortcut";

/** A bridge that records what the shell asked of it. */
const fakeBridge = () => {
  const grabbed: unknown[] = [];
  const spawned: readonly string[][] = [];
  let heard: (() => void) | undefined;
  const bridge: TerminalBridge = {
    grabShortcut: (shortcut) => {
      grabbed.push(shortcut);
    },
    on: (_type, listener) => {
      heard = listener;
    },
    spawn: (command) => {
      (spawned as string[][]).push([...command]);
    },
  };
  return {
    bridge,
    /** The compositor delivering a claimed press, which is not a DOM event. */
    compositorPress: () => {
      if (heard === undefined) {
        throw new Error("test: nothing listened for the shortcut");
      } else {
        heard();
      }
    },
    grabbed,
    spawned,
  };
};

const press = (init: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent("keydown", {
    altKey: true,
    bubbles: true,
    cancelable: true,
    key: "Enter",
    ...init,
  });

describe("openTerminalOnAltEnter", () => {
  it("claims Alt+Enter from the compositor", () => {
    // Once a client holds the keyboard the page hears nothing, which is
    // exactly when another window is wanted. A claim takes the combination
    // out of the stream before the client is given it.
    const fake = fakeBridge();
    openTerminalOnAltEnter(fake.bridge, document.createElement("div"));
    expect(fake.grabbed).toStrictEqual([
      { alt: true, ctrl: false, key: 28, logo: false, shift: false },
    ]);
  });

  it("opens a terminal when the compositor delivers the press", () => {
    const fake = fakeBridge();
    openTerminalOnAltEnter(fake.bridge, document.createElement("div"));
    fake.compositorPress();
    expect(fake.spawned).toStrictEqual([["kitty"]]);
  });

  it("opens a terminal when the page hears the press itself", () => {
    // Before the first window there is nothing holding the keyboard, so the
    // claim never fires and the page is the only path.
    const fake = fakeBridge();
    const keys = document.createElement("div");
    openTerminalOnAltEnter(fake.bridge, keys);
    keys.dispatchEvent(press());
    expect(fake.spawned).toStrictEqual([["kitty"]]);
  });

  it("opens one terminal for a held key, not tens", () => {
    // A held combination repeats at the keyboard's rate; only the first of
    // them is a request to open something.
    const fake = fakeBridge();
    const keys = document.createElement("div");
    openTerminalOnAltEnter(fake.bridge, keys);
    keys.dispatchEvent(press());
    keys.dispatchEvent(press({ repeat: true }));
    keys.dispatchEvent(press({ repeat: true }));
    expect(fake.spawned).toStrictEqual([["kitty"]]);
  });

  it("leaves every other combination alone", () => {
    // Each modifier is part of the chord: Ctrl+Alt+Enter is one nobody
    // claimed, and the client that holds focus should still get it.
    const fake = fakeBridge();
    const keys = document.createElement("div");
    openTerminalOnAltEnter(fake.bridge, keys);
    keys.dispatchEvent(press({ altKey: false }));
    keys.dispatchEvent(press({ ctrlKey: true }));
    keys.dispatchEvent(press({ metaKey: true }));
    keys.dispatchEvent(press({ key: "a" }));
    expect(fake.spawned).toStrictEqual([]);
  });

  it("leaves Alt+Shift+Enter alone, because the claim does", () => {
    // The compositor matches on the exact modifier set, and what is claimed
    // has `shift: false`. A page that answered the shift variant anyway would
    // make one combination do two different things depending on whether a
    // client happened to hold the keyboard.
    const fake = fakeBridge();
    const keys = document.createElement("div");
    openTerminalOnAltEnter(fake.bridge, keys);

    const shifted = press({ shiftKey: true });
    keys.dispatchEvent(shifted);

    expect(fake.spawned).toStrictEqual([]);
    expect(shifted.defaultPrevented).toBe(false);
  });

  it("takes the key rather than letting it reach a client too", () => {
    // The SDK forwards every key over this one to whichever window has focus.
    // Without stopping it, Alt+Enter both opens a terminal and lands in the
    // window that was already there.
    // The stand-in sits *below* the element this listens on, which is what
    // capture is for and the only arrangement that proves it: a listener on an
    // ancestor is stopped either way, so putting it there would leave the
    // capture flag free to be wrong.
    const fake = fakeBridge();
    const keys = document.createElement("div");
    const window_ = document.createElement("div");
    keys.append(window_);
    const forwarded: KeyboardEvent[] = [];
    window_.addEventListener("keydown", (event) => {
      forwarded.push(event);
    });
    openTerminalOnAltEnter(fake.bridge, keys);

    const taken = press();
    window_.dispatchEvent(taken);
    expect(forwarded).toStrictEqual([]);
    expect(taken.defaultPrevented).toBe(true);

    const passed = press({ altKey: false });
    window_.dispatchEvent(passed);
    expect(forwarded).toHaveLength(1);
  });
});
