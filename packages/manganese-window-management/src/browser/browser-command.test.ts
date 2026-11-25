import { describe, expect, it } from "bun:test";

import {
  BROWSER_KEYS,
  BrowserCommand,
  browserCommandFor,
} from "./browser-command";

const press = (
  key: string,
  held: Partial<{
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }> = {},
) => ({
  altKey: false,
  ctrlKey: false,
  key,
  metaKey: false,
  shiftKey: false,
  ...held,
});

describe("browserCommandFor", () => {
  it("goes back and forward on Alt and the arrows", () => {
    expect(browserCommandFor(press("ArrowLeft", { altKey: true }))).toBe(
      BrowserCommand.Back,
    );
    expect(browserCommandFor(press("ArrowRight", { altKey: true }))).toBe(
      BrowserCommand.Forward,
    );
  });

  it("reloads on Ctrl+R, with Shift or without", () => {
    expect(browserCommandFor(press("r", { ctrlKey: true }))).toBe(
      BrowserCommand.Reload,
    );
    expect(
      browserCommandFor(press("R", { ctrlKey: true, shiftKey: true })),
    ).toBe(BrowserCommand.Reload);
  });

  // Matches the character. On a US layout plus is Shift+equals, and Chrome
  // also accepts unshifted equals.
  it("zooms in on Ctrl and plus, or the key plus is on", () => {
    expect(
      browserCommandFor(press("+", { ctrlKey: true, shiftKey: true })),
    ).toBe(BrowserCommand.ZoomIn);
    expect(browserCommandFor(press("=", { ctrlKey: true }))).toBe(
      BrowserCommand.ZoomIn,
    );
  });

  it("zooms out on Ctrl and minus, shifted or not", () => {
    expect(browserCommandFor(press("-", { ctrlKey: true }))).toBe(
      BrowserCommand.ZoomOut,
    );
    expect(
      browserCommandFor(press("_", { ctrlKey: true, shiftKey: true })),
    ).toBe(BrowserCommand.ZoomOut);
  });

  // Chrome finds on both Ctrl+F and Ctrl+Shift+F.
  it("finds in the page on Ctrl+F", () => {
    expect(browserCommandFor(press("f", { ctrlKey: true }))).toBe(
      BrowserCommand.Find,
    );
    expect(
      browserCommandFor(press("F", { ctrlKey: true, shiftKey: true })),
    ).toBe(BrowserCommand.Find);
  });

  it("resets the zoom on Ctrl+0", () => {
    expect(browserCommandFor(press("0", { ctrlKey: true }))).toBe(
      BrowserCommand.ZoomReset,
    );
  });

  // An extra modifier is a different chord, possibly a desktop binding.
  it("answers nothing with another modifier held", () => {
    expect(
      browserCommandFor(press("r", { ctrlKey: true, metaKey: true })),
    ).toBeUndefined();
    expect(
      browserCommandFor(press("r", { altKey: true, ctrlKey: true })),
    ).toBeUndefined();
    expect(
      browserCommandFor(press("ArrowLeft", { altKey: true, shiftKey: true })),
    ).toBeUndefined();
  });

  it("answers nothing for a key without its modifier", () => {
    expect(browserCommandFor(press("r"))).toBeUndefined();
    expect(browserCommandFor(press("ArrowLeft"))).toBeUndefined();
    expect(
      browserCommandFor(press("ArrowLeft", { ctrlKey: true })),
    ).toBeUndefined();
  });

  // Chrome's DevTools chord. Shift is what makes it DevTools: Ctrl+I alone is
  // a page's italic.
  it("inspects on Ctrl+Shift+I, and not on Ctrl+I", () => {
    expect(
      browserCommandFor(press("I", { ctrlKey: true, shiftKey: true })),
    ).toBe(BrowserCommand.Inspect);
    expect(browserCommandFor(press("i", { ctrlKey: true }))).toBeUndefined();
  });

  // Chrome's "print using the system dialog". Ctrl+P alone is Chrome's Print
  // Preview, which the engine does not have.
  it("prints on Ctrl+Shift+P, and not on Ctrl+P", () => {
    expect(
      browserCommandFor(press("P", { ctrlKey: true, shiftKey: true })),
    ).toBe(BrowserCommand.Print);
    expect(browserCommandFor(press("p", { ctrlKey: true }))).toBeUndefined();
  });
});

/** `KeyboardEvent.key` for a key as Chrome's accelerators name it. */
const keyOf = (name: string, shiftKey: boolean): string => {
  if (name === "Left" || name === "Right") {
    return `Arrow${name}`;
  } else {
    return shiftKey ? name.toUpperCase() : name.toLowerCase();
  }
};

/** A key event for keys as Chrome's accelerators write them, such as `Ctrl+F`. */
const pressOf = (keys: string) => {
  const parts = keys.split("+");
  const shiftKey = parts.includes("Shift");
  return press(keyOf(parts.at(-1) ?? "", shiftKey), {
    altKey: parts.includes("Alt"),
    ctrlKey: parts.includes("Ctrl"),
    shiftKey,
  });
};

describe("BROWSER_KEYS", () => {
  it("are each a browser command's keys", () => {
    expect(
      BROWSER_KEYS.filter(
        (keys) => browserCommandFor(pressOf(keys)) === undefined,
      ),
    ).toStrictEqual([]);
  });

  it("keep Find, Reload and history from extensions", () => {
    expect(BROWSER_KEYS).toEqual(
      expect.arrayContaining(["Ctrl+F", "Ctrl+R", "Alt+Left", "Alt+Right"]),
    );
  });
});
