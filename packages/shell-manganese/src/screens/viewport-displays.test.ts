import { describe, expect, it } from "bun:test";

import { viewportDisplays } from "./viewport-displays";

/** A window stub whose size and resize listeners the test controls. */
class FakeWindow {
  devicePixelRatio = 1;
  innerHeight = 800;
  innerWidth = 1280;

  #resized: (() => void) | undefined;

  addEventListener(_event: "resize", listener: () => void): void {
    this.#resized = listener;
  }

  // Remove the listener only if it is still registered, as a real target does.
  removeEventListener(_event: "resize", listener: () => void): void {
    if (this.#resized === listener) {
      this.#resized = undefined;
    }
  }

  /** Resize the window, which resizes the desktop. */
  resizeTo(width: number, height: number): void {
    this.innerWidth = width;
    this.innerHeight = height;
    this.#resized?.();
  }

  get listening(): boolean {
    return this.#resized !== undefined;
  }
}

const sourceOver = (view: FakeWindow) =>
  viewportDisplays(view as unknown as Window);

describe("viewportDisplays", () => {
  it("describes the window as the only display", () => {
    const view = new FakeWindow();
    view.devicePixelRatio = 2;

    expect(sourceOver(view).displays).toStrictEqual([
      { name: "page", position: [0, 0], scale: 2, size: [1280, 800] },
    ]);
  });

  it("reads the window when it is asked, not when it was built", () => {
    // The provider reads this on mount, after construction; a size copied at
    // construction would predate the first layout.
    const view = new FakeWindow();
    const source = sourceOver(view);

    view.resizeTo(1920, 1080);

    expect(source.displays?.[0]?.size).toStrictEqual([1920, 1080]);
  });

  it("describes the desktop again when the window changes size", () => {
    // Here the desktop is the window, so a resize changes the desktop.
    const view = new FakeWindow();
    const described: (readonly number[])[] = [];
    sourceOver(view).onDisplays((displays) => {
      described.push(displays[0]?.size ?? []);
    });

    view.resizeTo(1920, 1080);

    expect(described).toStrictEqual([[1920, 1080]]);
  });

  it("stops listening when the provider tears it down", () => {
    // The source outlives the provider; a leftover listener would update an
    // unmounted tree.
    const view = new FakeWindow();
    const stop = sourceOver(view).onDisplays(() => undefined);

    stop();

    expect(view.listening).toBe(false);
  });
});
