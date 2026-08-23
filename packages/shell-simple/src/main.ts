// Electron host for the simple shell.
//
// The same bargain the reference chrome strikes — Electron renders the page and
// the *preload* holds the Unix socket to the compositor, because a frame's
// pixels crossing Electron's IPC cost 79ms each against ~8ms for the GPU
// readback that produced them. What is left here is what a renderer cannot do
// for itself: opening the window, and dying with a reason on its behalf.
//
// This shell has no diagnostics channel and no `<webview>`, so it needs nothing
// else of its host. See `@domicile/shell-manganese` for the full arrangement.

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

// This shell wires nothing else onto its window: no `<webview>` to take keys
// out of, and nothing that asks to be resized.
const createWindow = (): void => {
  const win = openChromeWindow(
    {
      composited,
      preload: path.join(dirname, "preload.cjs"),
      socketPath,
    },
    (options) => new BrowserWindow(options),
    fail,
  );
  loadChromePage(
    win,
    path.join(dirname, "../renderer/main_window/index.html"),
    fail,
  );
};

const main = (): void => {
  app.on("window-all-closed", () => {
    app.quit();
  });
  orDieStarting(
    fail,
    app.whenReady().then(() => {
      // The renderer holds the socket, so it is the half that learns the
      // compositor is gone — and it can neither write to stderr nor stop the
      // app.
      stopOnChromeFailure({ ...sayAndStop, ipc: ipcMain });
      createWindow();
    }),
  );
};

main();
