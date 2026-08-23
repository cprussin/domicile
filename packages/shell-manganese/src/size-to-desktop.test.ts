import { describe, expect, it } from "bun:test";

import { CHROME_DESKTOP_SIZE_CHANNEL } from "./desktop-size-channel";
import { sizeToDesktopUnlessComposited } from "./size-to-desktop";

type Listener = (event: { sender: unknown }, ...args: number[]) => void;

/** The main process's IPC, which every window in it shares. */
class FakeIpc {
  readonly #listeners = new Map<string, Set<Listener>>();

  on(channel: string, listener: Listener): void {
    const registered = this.#listeners.get(channel) ?? new Set<Listener>();
    registered.add(listener);
    this.#listeners.set(channel, registered);
  }

  off(channel: string, listener: Listener): void {
    this.#listeners.get(channel)?.delete(listener);
  }

  /** A page asking, as Electron delivers it: to everyone on the channel. */
  ask(sender: unknown, width: number, height: number): void {
    for (const listener of this.#listeners.get(CHROME_DESKTOP_SIZE_CHANNEL) ??
      []) {
      listener({ sender }, width, height);
    }
  }
}

/** One window and the page in it, recording the sizes it was given. */
class FakeWindow {
  readonly sizes: (readonly number[])[] = [];

  readonly webContents = {
    once: (_event: "destroyed", listener: () => void) => {
      this.#destroyed = listener;
    },
  };

  #destroyed: (() => void) | undefined;

  setContentSize(width: number, height: number): void {
    this.sizes.push([width, height]);
  }

  /** The window going away, which is what takes its listener off the IPC. */
  destroy(): void {
    const destroyed = this.#destroyed;
    if (destroyed === undefined) {
      throw new Error("nothing listened for the page being destroyed");
    } else {
      destroyed();
    }
  }
}

/**
 * One window wired to `ipc`, which every window in the process shares.
 *
 * Down the copy path, which is the one where a size is ours to set at all.
 */
const hosting = (ipc = new FakeIpc()) => {
  const window = new FakeWindow();
  sizeToDesktopUnlessComposited(false, window, ipc);
  return { ipc, window };
};

describe("sizeToDesktopUnlessComposited", () => {
  it("resizes the window to the size its own page asked for", () => {
    const { ipc, window } = hosting();

    ipc.ask(window.webContents, 3840, 1080);

    expect(window.sizes).toStrictEqual([[3840, 1080]]);
  });

  it("ignores a size another window's page asked for", () => {
    // `ipcMain` is the whole process's: every window's asks arrive on this
    // channel, and a window that answered one from a page that is not its own
    // would be resized to somebody else's desktop.
    const { ipc, window } = hosting();
    const other = hosting(ipc);

    ipc.ask(other.window.webContents, 1280, 800);

    expect(window.sizes).toStrictEqual([]);
    expect(other.window.sizes).toStrictEqual([[1280, 800]]);
  });

  it("stops listening once its page is gone", () => {
    // The listener outlives the window it was wired for otherwise, and every
    // window ever opened would still be answering.
    const { ipc, window } = hosting();

    window.destroy();
    ipc.ask(window.webContents, 3840, 1080);

    expect(window.sizes).toStrictEqual([]);
  });

  it("leaves the size alone where Domicile composites the window", () => {
    // The compositor gives that window the whole output whatever is asked for,
    // so a `setContentSize` is a request fighting a configure it always loses
    // to. The page asks either way — it holds the socket the desktop is
    // described over, and cannot tell the two paths apart.
    const ipc = new FakeIpc();
    const window = new FakeWindow();

    sizeToDesktopUnlessComposited(true, window, ipc);
    ipc.ask(window.webContents, 3840, 1080);

    expect(window.sizes).toStrictEqual([]);
  });
});
