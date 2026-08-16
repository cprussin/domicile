// Exposes the compositor transport to the renderer as `window.domicileTransport`,
// the shape the chrome-sdk BridgeClient expects: { send, onMessage }.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("domicileTransport", {
  send: (text) => ipcRenderer.send("domicile:send", text),
  onMessage: (cb) => ipcRenderer.on("domicile:message", (_event, line) => cb(line)),
});
