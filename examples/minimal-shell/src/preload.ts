// The renderer's half of the host connection.
//
// The preload holds the compositor socket rather than the main process, and
// hands the page its messages by `postMessage`. That is not an arrangement of
// convenience: a frame's pixels crossing Electron's IPC is a structured clone
// of the whole buffer, measured at 9.9ms for a 1612x982 window against 0.11ms
// for the same frame posted with the buffer in the transfer list.

import { postHostMessages } from "@domicile/chrome-sdk/host-transport";
import {
  CHROME_FAILURE_CHANNEL,
  orDie,
  reportOnce,
} from "@domicile/electron-chrome-host/chrome-failure";
import { connectToCompositor } from "@domicile/electron-chrome-host/compositor-socket";
import { socketPathFrom } from "@domicile/electron-chrome-host/socket-path";
import { contextBridge, ipcRenderer } from "electron";

/** Say why on stderr and stop, which only the main process can do. */
const fail = reportOnce((line, code) => {
  ipcRenderer.send(CHROME_FAILURE_CHANNEL, line, code);
});

orDie(fail, () => {
  const stream = connectToCompositor({
    fail,
    onPageHide: (listener) => {
      window.addEventListener("pagehide", listener);
    },
    // Off the renderer's own command line, where `openChromeWindow` put it. The
    // socket has to be open before the page's first message, so there is no
    // round trip to the main process to ask for it.
    path: socketPathFrom(process.argv),
  });

  contextBridge.exposeInMainWorld(
    "domicileHost",
    postHostMessages(stream, (message, transfer) => {
      // `"*"` rather than an origin: the page is loaded over `file:`, whose
      // origin is opaque and matches nothing. The post is addressed by window
      // rather than by origin, and the page checks it came from itself.
      window.postMessage(message, "*", [...transfer]);
    }),
  );
});
