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
import {
  failHere,
  orDieStarting,
  stopOnChromeFailure,
} from "@domicile/electron-chrome-host/chrome-failure";
import {
  loadChromePage,
  openChromeWindow,
} from "@domicile/electron-chrome-host/chrome-window";
import { chromeSocketPath } from "@domicile/electron-chrome-host/socket-path";
import { app, BrowserWindow, ipcMain } from "electron";

import { CHROME_DIAGNOSTIC_CHANNEL } from "./diagnostic-channel";
import { takeGuestShortcuts } from "./guest-shortcuts";
import { sizeToDesktop } from "./size-to-desktop";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// biome-ignore lint/style/noProcessEnv: the main process is node; this is its only env source.
const environment = process.env;
const socketPath = chromeSocketPath(environment);

// Whether Domicile is compositing this window's clients itself, rather than
// sending their pixels here to be drawn into a canvas. Set by the runner that
// puts us on Domicile's own display.
const composited = environment.DOMICILE_COMPOSITED === "1";

// Saying why and stopping. This process does it on a page's behalf, over
// `CHROME_FAILURE_CHANNEL`, and on its own — a window whose page will not load
// is this half's failure, and throwing would not do it: Electron pins Node's
// legacy `--unhandled-rejections=warn`, so a throw inside a `.catch` here warns
// to a stderr nobody is reading and then exits 0.
const sayAndStop = {
  exit: (code: number) => {
    app.exit(code);
  },
  write: (line: string) => {
    process.stderr.write(line);
  },
};
const fail = failHere(sayAndStop);

const createWindow = (): void => {
  const win = openChromeWindow(
    {
      composited,
      preload: path.join(dirname, "preload.cjs"),
      socketPath,
      // `<domicile-webview>` embeds a real Electron `<webview>`.
      webviewTag: true,
    },
    (options) => new BrowserWindow(options),
    fail,
  );
  // Then what only this chrome asks of its window, while the page is not in it
  // yet. The keys a `<webview>` would otherwise swallow. The page claims what it
  // wants; this takes a claimed combination out of the embedded page before it
  // is given it, which is the only place it can be taken from a site holding
  // the keyboard.
  takeGuestShortcuts(win.webContents, ipcMain);
  // And the window's size, which the page is the only half to know: the
  // desktop is described over the socket the *renderer* holds. What
  // `openChromeWindow` opened at is for the moment before the handshake
  // answers, and for a chrome with no compositor behind it at all.
  //
  // Not where Domicile is compositing this window, which is the one case where
  // the size is not ours to set: the compositor gives that window the whole
  // desktop whatever is asked for, so a `setContentSize` would be a request
  // fighting a configure it always loses to. The page asks either way — it
  // cannot tell the two apart — and here is where the difference is known.
  if (!composited) {
    sizeToDesktop(win, ipcMain);
  }
  loadChromePage(
    win,
    path.join(dirname, "../renderer/main_window/index.html"),
    fail,
  );
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

const main = (): void => {
  app.on("window-all-closed", () => {
    app.quit();
  });
  orDieStarting(
    fail,
    app.whenReady().then(() => {
      printDiagnostics();
      // The other half of the same problem: the renderer holds the socket, so
      // it is the half that learns the compositor is gone — and it can neither
      // write to stderr nor stop the app.
      stopOnChromeFailure({ ...sayAndStop, ipc: ipcMain });
      createWindow();
    }),
  );
};

main();
