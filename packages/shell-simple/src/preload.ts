// The renderer's half of the host connection.
//
// Everything with a decision in it — where the socket is, what its death means,
// and what a throw at this scope costs — is in
// `@domicile/electron-chrome-host`, which loads and is tested without Electron.
// What is left here is this shell's own arrangement: which page gets the
// stream, and what else it is handed. This one is handed nothing else.

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
    // Passed as an `additionalArguments` switch by the main process rather than
    // read from the environment: the main process is where the shell's
    // configuration is resolved, and a renderer that read it again could
    // disagree with the window it belongs to.
    path: socketPathFrom(process.argv),
  });

  contextBridge.exposeInMainWorld(
    "domicileHost",
    postHostMessages(
      stream,
      // The pixels do not go over the context bridge at all: a bridged call
      // structured-clones every argument, which for a 1612x982 window measured
      // 9.9ms a frame. They are posted with the buffer in the transfer list,
      // which *moves* them — the same frames at 0.11ms.
      //
      // `"*"` rather than an origin: the page is loaded from a build directory
      // over `file:`, whose origin is opaque and never matches anything. The
      // post is not addressed by origin but by *window* — this is the same
      // window, and the page checks that the post came from it.
      (message, transfer) => {
        window.postMessage(message, "*", [...transfer]);
      },
    ),
  );
});
