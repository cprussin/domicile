// Exposes the compositor transport to the renderer as
// `window.domicileTransport`, the shape the chrome-sdk BridgeClient expects.

import { contextBridge, ipcRenderer } from "electron";

import { CHROME_TO_HOST_CHANNEL, HOST_TO_CHROME_CHANNEL } from "./ipc-channels";

contextBridge.exposeInMainWorld("domicileTransport", {
  onMessage: (callback: (text: string) => void) => {
    ipcRenderer.on(HOST_TO_CHROME_CHANNEL, (_event, frame: string) => {
      callback(frame);
    });
  },
  send: (text: string) => {
    ipcRenderer.send(CHROME_TO_HOST_CHANNEL, text);
  },
});
