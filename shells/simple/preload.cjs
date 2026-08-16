// Exposes the compositor transport to the renderer as `window.loomTransport`,
// the shape the chrome-sdk BridgeClient expects: { send, onMessage }.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("loomTransport", {
  send: (text) => ipcRenderer.send("loom:send", text),
  onMessage: (cb) => ipcRenderer.on("loom:message", (_event, line) => cb(line)),
});
