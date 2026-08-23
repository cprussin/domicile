// The renderer's half of the host connection.
//
// This holds the compositor socket itself rather than receiving its messages
// from the main process, and that is the point of it. Electron's IPC
// structured-clones what it carries, which for a frame's pixels is megabytes
// per frame across a process boundary: measured at 79ms average and 237ms
// worst against ~8ms for the GPU readback that produced them, it was the
// single largest cost in the copy path.
//
// Reading here left one copy: the context bridge's, in-process, into the page
// — 9.9ms average for a 1612x982 window, because a bridged call
// structured-clones every argument. So the pixels do not go over the bridge
// at all now. They are posted with `window.postMessage` and the buffer in the
// transfer list, which *moves* them: the same frames at **0.11ms**. Only the
// small things — the page saying it is listening, and what it sends back —
// still cross the bridge, where a clone costs nothing.
//
// The whole body runs inside `orDie`. Electron catches a throw at preload
// scope, logs it to the renderer's devtools console — which nobody has open
// while using a desktop — and then loads the page anyway, where
// `window.domicileTransport` is missing and the shell's own no-op fallback
// brings up a permanently deaf desktop. A shell that cannot reach the
// compositor has to say so where it can be read, and stop.

import net from "node:net";
import { postHostMessages } from "@domicile/chrome-sdk/host-transport";
import { contextBridge, ipcRenderer } from "electron";

import type { Chord } from "./chord";
import {
  CHROME_DESKTOP_SIZE_CHANNEL,
  CHROME_DIAGNOSTIC_CHANNEL,
  CHROME_FAILURE_CHANNEL,
  CHROME_GRAB_SHORTCUT_CHANNEL,
  CHROME_SHORTCUT_CHANNEL,
} from "./ipc-channels";
import { socketFailed } from "./socket-failure";
import { socketPathFrom } from "./socket-path";

/**
 * Say why on stderr and stop, which only the main process can do.
 *
 * Once. `app.exit` does not stop an IPC message already queued behind it, so
 * two failures arriving together — a throw at preload scope and the socket
 * error it left in flight — both reach the terminal, and the second is at best
 * redundant and at worst a wrong account of the first. Whichever spoke first
 * is the one that knows.
 */
let said = false;
const fail = (line: string, code: number): void => {
  if (!said) {
    said = true;
    ipcRenderer.send(CHROME_FAILURE_CHANNEL, line, code);
  }
};

const orDie = (start: () => void): void => {
  try {
    start();
  } catch (failure: unknown) {
    const said = failure instanceof Error ? failure.message : String(failure);
    fail(`domicile: the chrome could not start: ${said}\n`, 1);
  }
};

orDie(() => {
  // Passed as an `additionalArguments` switch by the main process rather than
  // read from the environment: the main process is where the shell's
  // configuration is resolved, and a renderer that read it again could
  // disagree with the window it belongs to.
  const socketPath = socketPathFrom(process.argv);

  const socket = net.connect(socketPath);
  const lost = socketFailed(fail, socketPath);
  socket.on("error", lost);
  // `error` is not the common way to lose a compositor. A peer that dies on a
  // Unix stream socket sends a FIN, which Node reports as `end` then `close`
  // and never as an error — so without this the desktop goes on drawing a
  // still of a machine that is gone.
  // `hadError` is what keeps this from speaking over the `error` handler.
  // Node emits `close` after *every* `error`, so an unguarded one reports a
  // second time and gets it wrong: a socket that was never there reads as a
  // compositor that closed the connection, which is the commonest failure
  // there is followed by a false account of it.
  const compositorClosed = (hadError: boolean): void => {
    if (!hadError) {
      lost(new Error("the compositor closed the connection"));
    }
  };
  socket.on("close", compositorClosed);
  // Except when it is *this page* going away. A reload — or the window
  // closing on the way out of the app — tears the preload's Node environment
  // down with the document, and the socket closing on the way is not a
  // compositor that died. Read as one it would print a failure and exit
  // non-zero on every reload and on every ordinary quit.
  //
  // The handler comes off before the socket is closed, rather than a flag
  // being set and checked, so *this* ordering is not something to get right.
  // (The one that is, `error` before `close`, is handled above.)
  window.addEventListener("pagehide", () => {
    socket.off("close", compositorClosed);
    socket.destroy();
  });

  contextBridge.exposeInMainWorld(
    "domicileHost",
    postHostMessages(
      {
        onData: (listener) => {
          socket.on("data", listener);
        },
        write: (text) => {
          socket.write(text);
        },
      },
      // `"*"` rather than an origin: the page is loaded from a build directory
      // over `file:`, whose origin is opaque and never matches anything. The
      // post is not addressed by origin but by *window* — this is the same
      // window, and the page checks that the post came from it.
      (message, transfer) => {
        window.postMessage(message, "*", [...transfer]);
      },
    ),
  );

  // Kept off `domicileHost`: that object is the host protocol, whose shape
  // the SDK's `Transport` type fixes. This is the shell asking its own Electron
  // host for things the eventual CEF embedder will answer some other way — or
  // not at all.
  contextBridge.exposeInMainWorld("domicileDiagnostics", {
    report: (line: string) => {
      ipcRenderer.send(CHROME_DIAGNOSTIC_CHANNEL, line);
    },
  });

  // And the window itself, which is this process's rather than the page's.
  // The page is the only half that knows how big the desktop is — it is
  // described over the socket held here — and the only half that cannot act
  // on it.
  contextBridge.exposeInMainWorld("domicileWindow", {
    sizeToDesktop: (width: number, height: number) => {
      ipcRenderer.send(CHROME_DESKTOP_SIZE_CHANNEL, width, height);
    },
  });

  // And saying why and stopping, which is `fail` above reached from the page
  // rather than from here. The renderer holds the socket, so the preload is
  // what learns the compositor is gone — but the *page* is what learns the two
  // halves cannot talk to each other, and it can no more write to stderr or
  // stop the app than this half can. Once either way: `fail` reports the first
  // failure and ignores what follows it.
  contextBridge.exposeInMainWorld("domicileFailure", {
    report: (line: string, code: number) => {
      fail(line, code);
    },
  });

  // The other half of the same: the page claims a key combination from the
  // pages it embeds, and hears the presses the main process took out of one.
  // A `<webview>` never delivers a key to its embedder, so without this the
  // desktop's own combinations stop working the moment a site has the
  // keyboard. See `guest-shortcuts`.
  contextBridge.exposeInMainWorld("domicileGuestShortcuts", {
    grab: (chord: Chord) => {
      ipcRenderer.send(CHROME_GRAB_SHORTCUT_CHANNEL, chord);
    },
    // One listener, replaced rather than added to — the same contract the
    // SDK's `on` has, and for the same reason: the page registers this from an
    // effect, and an `ipcRenderer.on` that stacked would open a window per
    // registration for a single press.
    onPressed: (listener: (chord: Chord) => void) => {
      ipcRenderer.removeAllListeners(CHROME_SHORTCUT_CHANNEL);
      ipcRenderer.on(CHROME_SHORTCUT_CHANNEL, (_event, chord: Chord) => {
        listener(chord);
      });
    },
  });
});
