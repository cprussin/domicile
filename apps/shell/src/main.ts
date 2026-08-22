// Electron host for the reference chrome shell.
//
// This is the prototype's window: Electron renders the chrome (full CSS/JS) and
// the *preload* owns the Unix socket to the compositor. (The eventual target
// embeds CEF directly; Electron gets us a visible, testable chrome now.)
//
// The socket used to be held here and its messages forwarded over Electron's
// IPC, which structured-clones what it carries across a process boundary. For
// a frame's pixels that measured 79ms on hardware — ten times the GPU readback
// that produced them, and the largest single cost in the copy path. So this
// process keeps only what a renderer cannot do for itself: opening the window,
// writing to the terminal it was started from, and seeing the keys pressed in
// the pages the window embeds.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { takeGuestShortcuts } from "./guest-shortcuts";
import {
  CHROME_DIAGNOSTIC_CHANNEL,
  CHROME_FAILURE_CHANNEL,
} from "./ipc-channels";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;
const BACKGROUND_COLOR = "#0b0e17";

// Transparent, because Domicile is drawing the windows underneath us.
const TRANSPARENT = "#00000000";

// The compositor's chrome socket. `XDG_RUNTIME_DIR` must stay short: a Unix
// socket path is capped near 108 bytes (SUN_LEN), which a deep scratch
// directory blows past.
// biome-ignore lint/style/noProcessEnv: the main process is node; this is its only env source.
const environment = process.env;
const socketPath =
  environment.DOMICILE_CHROME_SOCKET ??
  path.join(environment.XDG_RUNTIME_DIR ?? ".", "domicile-chrome.sock");

// Whether Domicile is compositing this window's clients itself, rather than
// sending their pixels here to be drawn into a canvas. Set by the runner that
// puts us on Domicile's own display; the window has to be transparent for it,
// so that the `<app>` elements are holes the clients show through.
const composited = environment.DOMICILE_COMPOSITED === "1";

const createWindow = (): void => {
  const win = new BrowserWindow({
    backgroundColor: composited ? TRANSPARENT : BACKGROUND_COLOR,
    // The desktop has no window furniture of its own, and the compositor gives
    // it the whole output regardless of what is asked for here.
    frame: !composited,
    height: WINDOW_HEIGHT,
    transparent: composited,
    webPreferences: {
      // The preload reads the socket path off its own command line: it has to
      // connect before the page's first message, so there is no round trip to
      // ask for it.
      additionalArguments: [`--domicile-chrome-socket=${socketPath}`],
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(dirname, "preload.cjs"),
      // For this renderer, so its preload can hold the socket: a sandboxed
      // preload gets a polyfilled subset of Node with no `net` in it. This
      // unconfines the whole renderer process, page included — the page keeps
      // `contextIsolation`, which is a different guarantee — but the only
      // thing in this process is our own bundle, and `<webview>` guests stay
      // sandboxed regardless of what their embedder asks for, so remote
      // content is still in a confined process of its own.
      sandbox: false,
      // `<domicile-webview>` embeds a real Electron `<webview>`, which is off
      // by default.
      webviewTag: true,
    },
    width: WINDOW_WIDTH,
  });
  // The keys a `<webview>` would otherwise swallow. The page claims what it
  // wants; this takes a claimed combination out of the embedded page before it
  // is given it, which is the only place it can be taken from a site holding
  // the keyboard.
  takeGuestShortcuts(win.webContents, ipcMain);
  win
    .loadFile(path.join(dirname, "../renderer/main_window/index.html"))
    .catch((failure: unknown) => {
      throw new Error("domicile: the chrome's page would not load", {
        cause: failure,
      });
    });
  if (composited) {
    // The design system paints `html`, which would cover a transparent window
    // with a solid desktop and leave the `<app>` holes showing that instead of
    // the clients behind them. Injected rather than authored into the shell's
    // stylesheet because it is a property of how this window is being
    // presented, not of the chrome: the same page in the copy path wants its
    // background.
    win.webContents.on("did-finish-load", () => {
      win.webContents
        .insertCSS("html, body { background: transparent !important; }")
        .catch((failure: unknown) => {
          // Thrown, unlike the renderer's handshake failure: this is the main
          // process, where an unhandled rejection is loud on stderr and exits
          // non-zero. In a renderer it would land in a devtools console nobody
          // has open, which is why that side reports instead.
          throw new Error("domicile: could not clear the window's background", {
            cause: failure,
          });
        });
    });
  }
};

// The renderer's own console goes to devtools, which nobody has open while
// driving the prototype from a terminal. This puts the chrome's half of the
// frame timing on the same stdout as the compositor's, which is the only place
// the two can be read against each other.
const printDiagnostics = (): void => {
  ipcMain.on(CHROME_DIAGNOSTIC_CHANNEL, (_event, line: string) => {
    process.stdout.write(`chrome: ${line}\n`);
  });
};

// The other half of the same problem: the renderer holds the socket, so it is
// the half that learns the compositor is gone — and it can neither write to
// stderr nor stop the app.
//
// `exit` rather than `quit`: a page must not be able to veto the shutdown from
// `beforeunload`, and the code has to be non-zero.
const stopOnFailure = (): void => {
  ipcMain.on(CHROME_FAILURE_CHANNEL, (_event, line: string, code: number) => {
    process.stderr.write(line);
    app.exit(code);
  });
};

const main = (): void => {
  app.on("window-all-closed", () => {
    app.quit();
  });
  app
    .whenReady()
    .then(() => {
      printDiagnostics();
      stopOnFailure();
      createWindow();
    })
    .catch((error: unknown) => {
      throw new Error("domicile shell: failed to open the window", {
        cause: error,
      });
    });
};

main();
