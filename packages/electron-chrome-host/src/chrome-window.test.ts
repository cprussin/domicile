import { describe, expect, it } from "bun:test";
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

import type { ChromeWindow } from "./chrome-window";
import { loadChromePage, openChromeWindow } from "./chrome-window";

const CHROME: ChromeWindow = {
  composited: false,
  preload: "/build/preload.cjs",
  socketPath: "/run/user/1000/domicile-chrome.sock",
};

const PAGE = "/build/renderer/main_window/index.html";

/** A line for stderr and an exit code, as the host would be given them. */
type Said = [line: string, code: number];

/** What a rejection of the call this stood in for would be handed to. */
type OnRejected = (failure: unknown) => void;

/**
 * A promise that hands its rejection handler back rather than running it.
 *
 * A real rejected promise would run the arm under test in a microtask, so every
 * assertion about it would have to await a turn of the loop first. Handing the
 * handler over runs the arm where the test called it, and lets the test choose
 * what it rejects with.
 */
const capturing = <T>(handlers: OnRejected[]): Promise<T> =>
  ({
    catch: (onRejected: OnRejected) => {
      handlers.push(onRejected);
    },
  }) as unknown as Promise<T>;

/** A window the test drives, standing in for the one Electron would build. */
const fakeWindow = () => {
  const listeners: [event: string, listener: () => void][] = [];
  const injected: string[] = [];
  const injectionFailed: OnRejected[] = [];
  const loadFailed: OnRejected[] = [];
  const loadedPages: string[] = [];
  const opened: BrowserWindowConstructorOptions[] = [];
  const said: Said[] = [];
  const win = {
    loadFile: (page: string) => {
      loadedPages.push(page);
      return capturing<void>(loadFailed);
    },
    webContents: {
      insertCSS: (css: string) => {
        injected.push(css);
        return capturing<string>(injectionFailed);
      },
      // The event name is recorded rather than ignored: what this module defers
      // to is the whole of what it decides about the injection, and a fake that
      // fired every listener whatever it was registered under would let
      // `dom-ready` — which lands before the page's stylesheet has painted —
      // pass for `did-finish-load`.
      on: (event: string, listener: () => void) => {
        listeners.push([event, listener]);
      },
    },
  } as unknown as BrowserWindow;
  return {
    fail: (line: string, code: number) => {
      said.push([line, code]);
    },
    /** What the page's load fires, once it has finished. */
    finishLoad: () => {
      for (const [event, listener] of [...listeners]) {
        if (event === "did-finish-load") {
          listener();
        }
      }
    },
    injected,
    injectionFailed,
    loadedPages,
    loadFailed,
    open: (options: BrowserWindowConstructorOptions) => {
      opened.push(options);
      return win;
    },
    opened: () => {
      const options = opened.at(-1);
      if (options === undefined) {
        throw new Error("test: no window was opened");
      } else {
        return options;
      }
    },
    said,
    win,
  };
};

describe("openChromeWindow", () => {
  it("hands the window back for the chrome to wire up", () => {
    const fake = fakeWindow();
    expect(openChromeWindow(CHROME, fake.open, fake.fail)).toBe(fake.win);
  });

  it("passes the compositor socket on the renderer's own command line", () => {
    // The preload has to connect before the page's first message, so there is
    // no round trip to the main process to ask where the socket is.
    const fake = fakeWindow();
    openChromeWindow(CHROME, fake.open, fake.fail);
    expect(fake.opened().webPreferences?.additionalArguments).toStrictEqual([
      `--domicile-chrome-socket=${CHROME.socketPath}`,
    ]);
    expect(fake.opened().webPreferences?.preload).toBe(CHROME.preload);
  });

  it("leaves the renderer unsandboxed so its preload can hold the socket", () => {
    // A sandboxed preload gets a polyfilled subset of Node with no `net` in
    // it. The page keeps `contextIsolation`, which is a different guarantee.
    const fake = fakeWindow();
    openChromeWindow(CHROME, fake.open, fake.fail);
    const preferences = fake.opened().webPreferences;
    expect(preferences?.sandbox).toBe(false);
    expect(preferences?.contextIsolation).toBe(true);
    expect(preferences?.nodeIntegration).toBe(false);
  });

  it("gives the window a size, a background and a frame in the copy path", () => {
    // The size is what the user gets until the page asks for another, and for
    // a chrome with no compositor behind it at all.
    const fake = fakeWindow();
    openChromeWindow(CHROME, fake.open, fake.fail);
    expect(fake.opened()).toMatchObject({ height: 800, width: 1280 });
    expect(fake.opened().transparent).toBe(false);
    expect(fake.opened().frame).toBe(true);
    expect(fake.opened().backgroundColor).not.toBe("#00000000");
  });

  it("takes the background and the frame away where Domicile composites it", () => {
    // The `<domicile-app>` elements are holes the clients show through, so
    // anything this window paints is between the user and the window they are
    // looking at. The desktop has no furniture of its own either — and the
    // compositor gives it the whole output whatever is asked for here.
    const fake = fakeWindow();
    openChromeWindow({ ...CHROME, composited: true }, fake.open, fake.fail);
    expect(fake.opened().transparent).toBe(true);
    expect(fake.opened().frame).toBe(false);
    expect(fake.opened().backgroundColor).toBe("#00000000");
  });

  it("turns the webview tag on only for a chrome that embeds one", () => {
    const embedding = fakeWindow();
    openChromeWindow(
      { ...CHROME, webviewTag: true },
      embedding.open,
      embedding.fail,
    );
    expect(embedding.opened().webPreferences?.webviewTag).toBe(true);

    const plain = fakeWindow();
    openChromeWindow(CHROME, plain.open, plain.fail);
    expect(plain.opened().webPreferences?.webviewTag).not.toBe(true);
  });

  describe("the page's own background", () => {
    it("is cleared once it has loaded, where Domicile composites the window", () => {
      // A design system paints `html`, which would cover a transparent window
      // with a solid desktop and leave the holes showing that instead of the
      // clients behind them. Injected rather than authored into a shell's
      // stylesheet because it is a property of how this window is presented,
      // not of the chrome.
      const fake = fakeWindow();
      openChromeWindow({ ...CHROME, composited: true }, fake.open, fake.fail);
      expect(fake.injected).toStrictEqual([]);
      fake.finishLoad();
      expect(fake.injected).toStrictEqual([
        "html, body { background: transparent !important; }",
      ]);
    });

    it("is left alone in the copy path", () => {
      // The same page drawn into a canvas wants its background.
      const fake = fakeWindow();
      openChromeWindow(CHROME, fake.open, fake.fail);
      fake.finishLoad();
      expect(fake.injected).toStrictEqual([]);
    });

    it("says so and stops when it could not be cleared", () => {
      // Swallowed, this is a desktop drawing an opaque page over every window
      // on it with nothing said anywhere. Not thrown: Electron pins Node's
      // legacy `--unhandled-rejections=warn`, so a throw here would warn to a
      // stderr nobody is reading and then exit 0 — the swallow it looks like
      // the opposite of. Reported, it reaches the terminal and stops.
      const fake = fakeWindow();
      openChromeWindow({ ...CHROME, composited: true }, fake.open, fake.fail);
      fake.finishLoad();
      expect(fake.said).toStrictEqual([]);
      fake.injectionFailed.at(-1)?.(new Error("nope"));
      expect(fake.said).toStrictEqual([
        ["domicile: could not clear the window's background: nope\n", 1],
      ]);
    });
  });
});

describe("loadChromePage", () => {
  it("puts the chrome's page in its window", () => {
    const fake = fakeWindow();
    loadChromePage(fake.win, PAGE, fake.fail);
    expect(fake.loadedPages).toStrictEqual([PAGE]);
  });

  it("says which page would not load, and stops", () => {
    // A build that did not emit the renderer, most often. An empty window left
    // up saying nothing is worse than no window at all, and a throw would leave
    // exactly that: Electron warns on the unhandled rejection and exits 0.
    const fake = fakeWindow();
    loadChromePage(fake.win, PAGE, fake.fail);
    expect(fake.said).toStrictEqual([]);
    fake.loadFailed.at(-1)?.(new Error("ENOENT"));
    expect(fake.said).toStrictEqual([
      ["domicile: the chrome's page would not load: ENOENT\n", 1],
    ]);
  });
});
