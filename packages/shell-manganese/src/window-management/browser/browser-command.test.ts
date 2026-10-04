import { describe, expect, it } from "bun:test";

import { BrowserCommand, browserCommandFor } from "./browser-command";

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
});
