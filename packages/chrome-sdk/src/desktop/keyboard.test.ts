import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

const pressed = {
  altKey: false,
  chord: "Meta+Return",
  ctrlKey: false,
  keycode: 28,
  metaKey: true,
  shiftKey: false,
};

describe("keyboard", () => {
  it("reads no modifiers until the compositor says", () => {
    expect(
      desktop(new FakeDomicileHost().host).keyboard.modifiers,
    ).toBeUndefined();
  });

  it("reads the seat's modifiers", () => {
    const fake = new FakeDomicileHost();
    fake.set({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: true });

    expect(desktop(fake.host).keyboard.modifiers).toStrictEqual({
      alt: false,
      ctrl: true,
      meta: false,
      shift: true,
    });
  });

  it("grabs and gives back chords", () => {
    const fake = new FakeDomicileHost();
    const { keyboard } = desktop(fake.host);
    keyboard.grab("Meta+Return");
    keyboard.ungrab("Meta+Return");

    expect(fake.calls).toStrictEqual([
      ["grabShortcut", "Meta+Return"],
      ["ungrabShortcut", "Meta+Return"],
    ]);
  });

  it("hears a grabbed chord pressed and let go", async () => {
    const fake = new FakeDomicileHost();
    const { keyboard } = desktop(fake.host);
    const press = new Promise((resolve) => {
      keyboard.on("shortcut", resolve);
    });
    const release = new Promise((resolve) => {
      keyboard.on("shortcutrelease", resolve);
    });
    fake.dispatch("shortcut", pressed);
    fake.dispatch("shortcutrelease", pressed);

    expect(await press).toStrictEqual(pressed);
    expect(await release).toStrictEqual(pressed);
  });

  it("says the modifiers changed", async () => {
    const fake = new FakeDomicileHost();
    const changed = new Promise((resolve) => {
      desktop(fake.host).keyboard.on("modifierschange", () => {
        resolve(undefined);
      });
    });
    fake.set({ altKey: true });

    expect(await changed).toBeUndefined();
  });
});

describe("pointer", () => {
  it("warps the pointer", () => {
    const fake = new FakeDomicileHost();
    desktop(fake.host).pointer.warp(10, 20);

    expect(fake.calls).toStrictEqual([["warpPointer", 10, 20]]);
  });
});
