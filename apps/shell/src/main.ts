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
import { CHROME_TO_HOST_CHANNEL, HOST_TO_CHROME_CHANNEL } from "./ipc-channels";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;
const BACKGROUND_COLOR = "#0b0e17";

// The compositor's chrome socket. `XDG_RUNTIME_DIR` must stay short: a Unix
// socket path is capped near 108 bytes (SUN_LEN), which a deep scratch
// directory blows past.
// biome-ignore lint/style/noProcessEnv: the main process is node; this is its only env source.
const environment = process.env;
const socketPath =
  environment.DOMICILE_CHROME_SOCKET ??
  path.join(environment.XDG_RUNTIME_DIR ?? ".", "domicile-chrome.sock");

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    backgroundColor: BACKGROUND_COLOR,
    height: WINDOW_HEIGHT,
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
        win.webContents.send(HOST_TO_CHROME_CHANNEL, item.text, item.pixels);
      }
    }
  });

  ipcMain.on(CHROME_TO_HOST_CHANNEL, (_event, text: string) => {
    socket.write(withFrameDelimiter(text));
  });
};

const main = (): void => {
  app.on("window-all-closed", () => {
    app.quit();
  });
  app
    .whenReady()
    .then(() => {
      connectHost(createWindow());
    })
    .catch((error: unknown) => {
      throw new Error("domicile shell: failed to open the window", {
        cause: error,
      });
    });
};

main();
