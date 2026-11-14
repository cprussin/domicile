// The preload guard-electron-preload.sh gives window 1, as an Electron app's
// sandboxed preload would be written.
// biome-ignore lint/style/noCommonJs: a preload is CommonJS, as Electron runs it.
const { contextBridge, ipcRenderer } = require("electron");

// The preload's own world: the page must not see this.
window.secret = "the preload's";

contextBridge.exposeInMainWorld("guard", {
  ask: (n) => ipcRenderer.invoke("double", n),
  onPing: (callback) =>
    ipcRenderer.on("ping", (_event, value) => callback(value)),
  send: (channel, value) => ipcRenderer.send(channel, value),
});
