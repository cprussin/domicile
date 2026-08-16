// Electron host for the simple chrome shell.
//
// This is the prototype's window: Electron renders the chrome (full CSS/JS) and
// this main process owns the Unix socket to the compositor, bridging it to the
// renderer as `window.domicileTransport`. (The eventual target embeds CEF directly;
// Electron gets us a visible, testable chrome now.)

const { app, BrowserWindow, ipcMain } = require("electron");
const net = require("net");
const path = require("path");

const SOCKET =
  process.env.DOMICILE_CHROME_SOCKET ||
  path.join(process.env.XDG_RUNTIME_DIR || ".", "domicile-chrome.sock");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0b0e17",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // enables <domicile-webview>'s inner <webview>
    },
  });
  win.loadFile(path.join(__dirname, "index.html"));

  // Connect to the compositor's chrome socket and bridge it to the renderer.
  // Framing is newline-delimited JSON; the in-page BridgeClient deals in whole
  // JSON strings, so we add/strip the newlines here.
  let buf = "";
  const sock = net.connect(SOCKET);
  sock.on("connect", () => console.log("domicile chrome: connected to", SOCKET));
  sock.on("data", (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim() && !win.isDestroyed()) win.webContents.send("domicile:message", line);
    }
  });
  sock.on("error", (err) => console.error("domicile chrome: socket error:", err.message));

  ipcMain.on("domicile:send", (_event, text) => {
    sock.write(text.endsWith("\n") ? text : text + "\n");
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
