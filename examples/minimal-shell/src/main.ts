// The Electron main process: open the window, and die with a reason.
//
// Everything a shell must do that a *page* cannot do for itself lives here, and
// there are only two things: putting a window on the compositor's display, and
// saying why on stderr and stopping when the page reports that it cannot go on.
// The compositor socket is deliberately not here — see `preload.ts`.

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

// The two variables this shell reads. `DOMICILE_CHROME_SOCKET` is where the
// host protocol is served, and `chromeSocketPath` is the SDK reading it for us;
// `DOMICILE_COMPOSITED` says Domicile is drawing the clients itself, so this
// window must be transparent where an app shows through rather than painting a
// desktop over them — nothing reads that one for you.
//
// Domicile sets up to two more. `WAYLAND_DISPLAY` is Electron's, by way of
// ozone, and arrives only when Domicile is compositing; and
// `DOMICILE_SHELL_SETTINGS` carries this shell's own `[shell.settings]` table
// as JSON — which this one has no use for, having no settings.
// biome-ignore lint/style/noProcessEnv: the main process is node; this is its only env source.
const environment = process.env;
const socketPath = chromeSocketPath(environment);
const composited = environment.DOMICILE_COMPOSITED === "1";

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
      stopOnChromeFailure({ ...sayAndStop, ipc: ipcMain });
      createWindow();
    }),
  );
};

main();
