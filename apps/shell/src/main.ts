// Electron host for the reference chrome shell.
//
// This is the prototype's window: Electron renders the chrome (full CSS/JS) and
// this main process owns the Unix socket to the compositor, bridging it to the
// renderer as `window.domicileTransport`. (The eventual target embeds CEF
// directly; Electron gets us a visible, testable chrome now.)

import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFrameReader,
  withFrameDelimiter,
} from "@domicile/chrome-sdk/newline-frames";
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

// Bridge the compositor socket to the renderer. Framing is newline-delimited
// JSON; the in-page BridgeClient deals in whole JSON strings, so the newlines
// are added and stripped here.
const connectHost = (win: BrowserWindow): void => {
  const socket = net.connect(socketPath);
  const readFrames = createFrameReader();

  socket.on("data", (chunk: Buffer) => {
    const frames = readFrames(chunk.toString());
    if (!win.isDestroyed()) {
      for (const frame of frames) {
        win.webContents.send(HOST_TO_CHROME_CHANNEL, frame);
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
