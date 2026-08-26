// The Electron main process: open the window, and die with a reason.
//
// Started by `launch.ts`, not by a user and not by Domicile.
//
// Everything a shell must do that a *page* cannot do for itself lives here, and
// there are only two things: putting a window on the compositor's display, and
// saying why on stderr and stopping when the page reports that it cannot go on.
// The compositor socket is deliberately not here — see `preload.ts`.

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  failHere,
  orDie,
  orDieStarting,
  stopOnChromeFailure,
} from "@domicile/electron-chrome-host/chrome-failure";
import {
  loadChromePage,
  openChromeWindow,
} from "@domicile/electron-chrome-host/chrome-window";
import type { CompositorSession } from "@domicile/electron-chrome-host/compositor-session";
import { sessionFromEnvironment } from "@domicile/electron-chrome-host/session-from-environment";
import { app, BrowserWindow, ipcMain } from "electron";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Saying why and stopping. The renderer holds the socket and so is what learns
// the compositor is gone, but it can neither write to stderr nor end the app —
// so it reports over an IPC channel and this half does both.
const sayAndStop = {
  exit: (code: number) => {
    app.exit(code);
  },
  write: (line: string) => {
    process.stderr.write(line);
  },
};
const fail = failHere(sayAndStop);

const createWindow = (session: CompositorSession): void => {
  const win = openChromeWindow(
    {
      composited: session.composited,
      preload: path.join(dirname, "preload.cjs"),
      socketPath: session.chromeSocket,
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
  // The compositor this chrome belongs to: which socket to speak to it on, and
  // whether it is drawing client windows itself rather than sending their
  // pixels here to be drawn into a canvas. Passed down by the launcher that
  // started both halves — see `launch.ts`.
  //
  // Behind `orDie` rather than at module scope, where reading it used to be. A
  // chrome started without a session — by hand, or by a launcher that skipped
  // the compositor — is a mistake worth a sentence, and a *synchronous* throw
  // in an Electron main process is not one: Electron's default handler puts up
  // a message box and waits, which on the headless X these checks run under is
  // a desktop that hangs rather than one that says why.
  orDie(fail, () => {
    // biome-ignore lint/style/noProcessEnv: the main process is node; this is its only env source.
    const session = sessionFromEnvironment(process.env);
    orDieStarting(
      fail,
      app.whenReady().then(() => {
        stopOnChromeFailure({ ...sayAndStop, ipc: ipcMain });
        createWindow(session);
      }),
    );
  });
};

main();
