// The window a chrome is drawn in.
//
// Two things every shell wants the same way, and one of them is not obvious.
// The window's *own* background and frame are a property of how it is being
// presented rather than of the chrome inside it: where Domicile composites the
// clients itself, the `<domicile-app>` elements are holes those clients show
// through, so anything this window paints — its background, the page's — is
// between the user and the window they are looking at. The same page down the
// copy path wants both.
//
// What each shell arranges for itself stays outside: the window comes back
// unloaded, so a chrome can wire up whatever it needs of it — the keys a
// `<webview>` swallows, the size its page asks for — before its page is in it.
// That is why loading is a second call rather than the end of the first.

import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

import type { ReportFailure } from "./chrome-failure";
import { reasonFor } from "./chrome-failure";

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;
const BACKGROUND_COLOR = "#0b0e17";

/** Transparent, because Domicile is drawing the windows underneath us. */
const TRANSPARENT = "#00000000";

/** What clears a page that paints its own background out of the way. */
const TRANSPARENT_PAGE = "html, body { background: transparent !important; }";

export type ChromeWindow = {
  /**
   * Whether Domicile is compositing this window's clients itself, rather than
   * sending their pixels here to be drawn into a canvas.
   *
   * Set by the runner that puts the chrome on Domicile's own display. It
   * decides everything this window paints, because in that path it paints over
   * the clients rather than around them.
   */
  composited: boolean;
  /** The built preload bundle, which is what holds the compositor socket. */
  preload: string;
  /** The compositor socket that preload is to connect to. */
  socketPath: string;
  /**
   * Whether this chrome embeds nested browsing contexts.
   *
   * `<domicile-webview>` renders a real Electron `<webview>`, which is off by
   * default; a chrome with no address bar in it has nothing to turn on.
   */
  webviewTag?: boolean;
};

/**
 * How this package's caller builds a window, since it does not import Electron
 * itself — every module here loads, and is tested, outside it.
 */
export type OpenWindow = (
  options: BrowserWindowConstructorOptions,
) => BrowserWindow;

/**
 * Open the window a chrome is drawn in, with nothing in it yet.
 *
 * @param fail - How this process says why it cannot go on and stops. See
 *   {@link failHere}: a throw would not do it here, because Electron pins
 *   Node's legacy `--unhandled-rejections=warn`.
 * @returns The window, for the shell to arrange and then load its page into.
 */
export const openChromeWindow = (
  chrome: ChromeWindow,
  open: OpenWindow,
  fail: ReportFailure,
): BrowserWindow => {
  const win = open(windowOptions(chrome));
  if (chrome.composited) {
    // Registered before the page is loaded rather than after, so there is no
    // race with the load this is waiting on.
    win.webContents.on("did-finish-load", () => {
      win.webContents.insertCSS(TRANSPARENT_PAGE).catch((failure: unknown) => {
        // Not survivable: this window is transparent and its clients are showing
        // through holes in a page that is now painting over them, so what is
        // left up is a desktop with every window on it covered. Said and
        // stopped rather than thrown — a throw in this process is a warning on
        // a stderr nobody is reading, and then exit 0.
        fail(
          `domicile: could not clear the window's background: ${reasonFor(failure)}\n`,
          1,
        );
      });
    });
  }
  return win;
};

/**
 * Put a chrome's page in its window.
 *
 * Separate from {@link openChromeWindow} so a shell can arrange its own window
 * in between; call it last.
 *
 * @param fail - As {@link openChromeWindow}'s.
 */
export const loadChromePage = (
  win: Pick<BrowserWindow, "loadFile">,
  page: string,
  fail: ReportFailure,
): void => {
  win.loadFile(page).catch((failure: unknown) => {
    // A build that did not emit the renderer, most often. Said and stopped for
    // the same reason the injection above is: a chrome whose page is not there
    // has nothing to show, and an empty window left up saying nothing is worse
    // than no window at all.
    fail(
      `domicile: the chrome's page would not load: ${reasonFor(failure)}\n`,
      1,
    );
  });
};

const windowOptions = ({
  composited,
  preload,
  socketPath,
  webviewTag = false,
}: ChromeWindow): BrowserWindowConstructorOptions => ({
  backgroundColor: composited ? TRANSPARENT : BACKGROUND_COLOR,
  // The desktop has no window furniture of its own, and the compositor gives it
  // the whole output regardless of what is asked for here.
  frame: !composited,
  height: WINDOW_HEIGHT,
  transparent: composited,
  webPreferences: {
    // The preload reads the socket path off its own command line: it has to
    // connect before the page's first message, so there is no round trip to the
    // main process to ask for it.
    additionalArguments: [`--domicile-chrome-socket=${socketPath}`],
    contextIsolation: true,
    nodeIntegration: false,
    preload,
    // For this renderer, so its preload can hold the socket: a sandboxed
    // preload gets a polyfilled subset of Node with no `net` in it. This
    // unconfines the whole renderer process, page included — the page keeps
    // `contextIsolation`, which is a different guarantee — but the only thing
    // in this process is the shell's own bundle, and `<webview>` guests stay
    // sandboxed regardless of what their embedder asks for, so remote content
    // is still in a confined process of its own.
    sandbox: false,
    webviewTag,
  },
  width: WINDOW_WIDTH,
});
