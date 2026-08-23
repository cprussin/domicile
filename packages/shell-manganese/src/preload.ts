// The renderer's half of the host connection.
//
// This holds the compositor socket itself rather than receiving its messages
// from the main process, and that is the point of it. Electron's IPC
// structured-clones what it carries, which for a frame's pixels is megabytes
// per frame across a process boundary: measured at 79ms average and 237ms worst
// against ~8ms for the GPU readback that produced them, it was the single
// largest cost in the copy path. The socket's own life — a FIN that is not an
// error, a reload that is not a death — lives in
// `@domicile/electron-chrome-host`, where it is tested without Electron and
// where the other shell gets the same answers.
//
// What is left here is this chrome's own arrangement: the stream, plus what it
// asks of its Electron host that the eventual CEF embedder will answer some
// other way — a line on a terminal, the size of the window it is drawn in, a
// way to say why it stopped, and the keys an embedded page would swallow.

import { postHostMessages } from "@domicile/chrome-sdk/host-transport";
import {
  CHROME_FAILURE_CHANNEL,
  orDie,
  reportOnce,
} from "@domicile/electron-chrome-host/chrome-failure";
import { connectToCompositor } from "@domicile/electron-chrome-host/compositor-socket";
import { socketPathFrom } from "@domicile/electron-chrome-host/socket-path";
import { contextBridge, ipcRenderer } from "electron";

import type { Chord } from "./chord";
import { CHROME_DESKTOP_SIZE_CHANNEL } from "./desktop-size-channel";
import { CHROME_DIAGNOSTIC_CHANNEL } from "./diagnostic-channel";
import {
  CHROME_GRAB_SHORTCUT_CHANNEL,
  CHROME_SHORTCUT_CHANNEL,
} from "./shortcut-channels";

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
      // which *moves* them — the same frames at 0.11ms. Only the small things
      // still cross the bridge, where a clone costs nothing.
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

  // Kept off `domicileHost`: that object is the host protocol, whose shape the
  // SDK's `Transport` type fixes. This is the shell asking its own Electron
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
  // stop the app than this half can. Once either way: `reportOnce` reports the
  // first failure and ignores what follows it.
  contextBridge.exposeInMainWorld("domicileFailure", {
    report: (line: string, code: number) => {
      fail(line, code);
    },
  });

  // The other half of the same: the page claims a key combination from the
  // pages it embeds, and hears the presses the main process took out of one.
  // A `<webview>` never delivers a key to its embedder, so without this the
  // desktop's own combinations stop working the moment a site has the keyboard.
  // See `guest-shortcuts`.
  contextBridge.exposeInMainWorld("domicileGuestShortcuts", {
    grab: (chord: Chord) => {
      ipcRenderer.send(CHROME_GRAB_SHORTCUT_CHANNEL, chord);
    },
    // One listener, replaced rather than added to — the same contract the SDK's
    // `on` has, and for the same reason: the page registers this from an
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
