// Exposes the compositor transport to the renderer as
// `window.domicileTransport`, the shape the chrome-sdk BridgeClient expects.

import { SampleWindow } from "@domicile/chrome-sdk/sample-window";
import { contextBridge, ipcRenderer } from "electron";

import {
  CHROME_DIAGNOSTIC_CHANNEL,
  CHROME_TO_HOST_CHANNEL,
  HOST_TO_CHROME_CHANNEL,
} from "./ipc-channels";

// What the main process → renderer hop costs. Measured here rather than in the
// page because this is the first code in the renderer process to see the
// message, so nothing of the page's own work is inside the number.
const hop = new SampleWindow();

contextBridge.exposeInMainWorld("domicileTransport", {
  onMessage: (
    callback: (text: string, pixels?: Uint8Array<ArrayBuffer>) => void,
  ) => {
    ipcRenderer.on(
      HOST_TO_CHROME_CHANNEL,
      (
        _event,
        text: string,
        pixels?: Uint8Array<ArrayBuffer>,
        sentAt?: number,
      ) => {
        if (sentAt !== undefined) {
          hop.record(Date.now() - sentAt);
        }
        callback(text, pixels);
      },
    );
  },
  send: (text: string) => {
    ipcRenderer.send(CHROME_TO_HOST_CHANNEL, text);
  },
});

// Kept off `domicileTransport`: that object is the host protocol, whose shape
// the SDK's `Transport` type fixes. This is the shell asking its own Electron
// host for things the eventual CEF embedder will answer some other way — or
// not at all.
contextBridge.exposeInMainWorld("domicileDiagnostics", {
  report: (line: string) => {
    ipcRenderer.send(CHROME_DIAGNOSTIC_CHANNEL, line);
  },
  takeIpcHop: () => hop.take(),
});
