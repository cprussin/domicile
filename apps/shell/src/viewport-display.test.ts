import { describe, expect, it } from "bun:test";

import { viewportDisplays } from "./viewport-display";

/** A window of a size, whose resize listeners can be turned. */
class FakeWindow {
  devicePixelRatio = 1;
  innerHeight = 800;
  innerWidth = 1280;

  #resized: (() => void) | undefined;

  addEventListener(_event: "resize", listener: () => void): void {
    this.#resized = listener;
  }

  // Only if it is still the registered one, the way a real target removes a
  // listener: a teardown that cleared whatever it found would silence a
  // handler that displaced it.
  removeEventListener(_event: "resize", listener: () => void): void {
    if (this.#resized === listener) {
      this.#resized = undefined;
    }
  }

  /** The window changing size, which is the desktop changing size. */
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
    // The provider reads this when it mounts, which is not when the shell
    // wired it up — a size copied at construction is the size before the
    // first layout.
    const view = new FakeWindow();
    const source = sourceOver(view);

    view.resizeTo(1920, 1080);

    expect(source.displays?.[0]?.size).toStrictEqual([1920, 1080]);
  });

  it("describes the desktop again when the window changes size", () => {
    // The desktop *is* the window here, so a window that changed is a desktop
    // that changed — the same thing the compositor re-describes for.
    const view = new FakeWindow();
    const described: (readonly number[])[] = [];
    sourceOver(view).onDisplays((displays) => {
      described.push(displays[0]?.size ?? []);
    });

    view.resizeTo(1920, 1080);

    expect(described).toStrictEqual([[1920, 1080]]);
  });

  it("stops listening when the provider tears it down", () => {
    // The source outlives the provider, so a teardown that left the listener
    // on would set state on a tree that is gone.
    const view = new FakeWindow();
    const stop = sourceOver(view).onDisplays(() => undefined);

    stop();

    expect(view.listening).toBe(false);
  });
});
