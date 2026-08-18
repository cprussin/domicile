// Electron host for the reference chrome shell.
//
// This is the prototype's window: Electron renders the chrome (full CSS/JS) and
// this main process owns the Unix socket to the compositor, bridging it to the
// renderer as `window.domicileTransport`. (The eventual target embeds CEF
// directly; Electron gets us a visible, testable chrome now.)

import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHostStreamReader } from "@domicile/chrome-sdk/host-stream";
import { withFrameDelimiter } from "@domicile/chrome-sdk/newline-frames";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  CHROME_DIAGNOSTIC_CHANNEL,
  CHROME_TO_HOST_CHANNEL,
  HOST_TO_CHROME_CHANNEL,
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

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    backgroundColor: composited ? TRANSPARENT : BACKGROUND_COLOR,
    // The desktop has no window furniture of its own, and the compositor gives
    // it the whole output regardless of what is asked for here.
    frame: !composited,
    height: WINDOW_HEIGHT,
    transparent: composited,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(dirname, "preload.cjs"),
      // `<domicile-webview>` embeds a real Electron `<webview>`, which is off
      // by default.
      webviewTag: true,
    },
    width: WINDOW_WIDTH,
  });
  win.loadFile(path.join(dirname, "../renderer/main_window/index.html"));
  if (composited) {
    // The design system paints `html`, which would cover a transparent window
    // with a solid desktop and leave the `<app>` holes showing that instead of
    // the clients behind them. Injected rather than authored into the shell's
    // stylesheet because it is a property of how this window is being
    // presented, not of the chrome: the same page in the copy path wants its
    // background.
    win.webContents.on("did-finish-load", () => {
      void win.webContents.insertCSS(
        "html, body { background: transparent !important; }",
      );
    });
  }
  return win;
};

// Bridge the compositor socket to the renderer. The stream is newline
// delimited JSON except for an app frame's pixels, which follow their header
// as raw bytes — so it is read as bytes, never as text (a pixel is as likely to
// be a newline as anything else). The pixels cross to the renderer as a
// Uint8Array rather than a string, which is the point of sending them this way.
const connectHost = (win: BrowserWindow): void => {
  const socket = net.connect(socketPath);
  const readHost = createHostStreamReader();

  socket.on("data", (chunk: Buffer) => {
    const items = readHost(chunk);
    if (!win.isDestroyed()) {
      for (const item of items) {
        // The send timestamp rides along so the preload can price the hop
        // itself: a frame's pixels are structured-cloned across the process
        // boundary, which for a full window is megabytes per frame and the
        // largest copy in the chrome's half of the path. `Date.now()` because
        // it is the one clock both processes read the same way.
        win.webContents.send(
          HOST_TO_CHROME_CHANNEL,
          item.text,
          item.pixels,
          Date.now(),
        );
      }
    }
  });

  ipcMain.on(CHROME_TO_HOST_CHANNEL, (_event, text: string) => {
    socket.write(withFrameDelimiter(text));
  });
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
  app
    .whenReady()
    .then(() => {
      printDiagnostics();
      connectHost(createWindow());
    })
    .catch((error: unknown) => {
      throw new Error("domicile shell: failed to open the window", {
        cause: error,
      });
    });
};

main();
