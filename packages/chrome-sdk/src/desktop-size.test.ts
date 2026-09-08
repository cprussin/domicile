import { describe, expect, it } from "bun:test";

import { reportDesktopSize } from "./desktop-size";

/** The window's half of what `reportDesktopSize` reads and listens to. */
const aWindow = (width: number, height: number) => {
  const listeners: (() => void)[] = [];
  return {
    addEventListener: (_type: "resize", listener: () => void) => {
      listeners.push(listener);
    },
    innerHeight: height,
    innerWidth: width,
    /** Resize it, the way a user dragging the window would. */
    resizeTo(next: readonly [number, number]) {
      this.innerWidth = next[0];
      this.innerHeight = next[1];
      for (const listener of listeners) {
        listener();
      }
    },
  };
};

const reportsFrom = (view: ReturnType<typeof aWindow>) => {
  const sent: [number, number][] = [];
  reportDesktopSize({ setDesktopSize: (size) => sent.push([...size]) }, view);
  return sent;
};

describe("reportDesktopSize", () => {
  // THE ONE THING THE COMPOSITOR CANNOT SEE FOR ITSELF. Where it presents it
  // owns the window and reads the size off it; under the engine the window is
  // the browser's. Without this first report the desktop stays at
  // `compositor.nested_size` for the whole run.
  it("reports the viewport it was given", () => {
    expect(reportsFrom(aWindow(1600, 1200))).toEqual([[1600, 1200]]);
  });

  // A desktop that learned its size once would be wrong from the first drag,
  // and every client would be told a screen size that is not the screen.
  it("reports again when the window changes", () => {
    const view = aWindow(1600, 1200);
    const sent = reportsFrom(view);
    view.resizeTo([800, 600]);
    expect(sent).toEqual([
      [1600, 1200],
      [800, 600],
    ]);
  });

  // Every resize, not just the first: `matchMedia` in the density reporter
  // beside this one arms `once` and re-arms itself, and a resize listener
  // written the same way would go deaf after one drag.
  it("keeps reporting", () => {
    const view = aWindow(1600, 1200);
    const sent = reportsFrom(view);
    view.resizeTo([800, 600]);
    view.resizeTo([1024, 768]);
    view.resizeTo([1280, 800]);
    expect(sent).toHaveLength(4);
    expect(sent.at(-1)).toEqual([1280, 800]);
  });
});
