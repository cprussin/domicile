// Entry point for the shell's renderer. `connectToHost` finds the compositor
// whichever way this page was opened — the fork, Electron, or a plain browser
// with no desktop at all — and this wires the SDK to it and mounts the React
// chrome on top.

import {
  BridgeClient,
  describeHandshakeFailure,
} from "@domicile/chrome-sdk/bridge";
import { connectToHost, hasHost } from "@domicile/chrome-sdk/connect-to-host";
import { reportDevicePixelRatio } from "@domicile/chrome-sdk/device-pixel-ratio";
import { placementTiming } from "@domicile/chrome-sdk/placement-timing";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import {
  applyPreference,
  loadPreference,
} from "@domicile/component-library/ThemeProvider";
import { createRoot } from "react-dom/client";

import { AppElements } from "./app-elements";
import { diagnosticLines } from "./diagnostic-lines";
import { displaysFrom } from "./display-source";
import { mountPoint } from "./mount-point";
import { Shell } from "./Shell";
import { viewportDisplays } from "./viewport-display";

import "./global.css";

/** Matches the compositor's reporting interval so the two lines interleave. */
const REPORT_EVERY_MS = 5000;

// Apply the persisted (or system) theme before React mounts, so the first paint
// uses the right semantic-token values. There is no paint before this: the
// stylesheet travels inside this module rather than in a render-blocking
// `<link>`, which is what ended this shell's theme flash — see
// `@domicile/component-library/vite-shell`. It used to say an `index.html` ran
// an inline copy of this first, and that file is gone.
applyPreference(loadPreference());

// One call, three places. Under the fork this opens a WebSocket to the bridge
// serving this page; under Electron it takes the channel the preload injected;
// in a plain browser it does nothing, so the shell still opens for styling
// work against a desktop that will never arrive.
const bridge = new BridgeClient(
  connectToHost(window, (url) => new WebSocket(url)),
);

// And where the desktop comes from, which is the same question one answer
// later: a host describes one, and with no host nothing ever will, so the
// window is the only geometry there is. Built here rather than in the chrome
// because this is where the host's absence is already known, and once rather
// than per render because a source is the connection.
const displays = hasHost(window)
  ? displaysFrom(bridge)
  : viewportDisplays(window);
const appElements = new AppElements();
registerElements(bridge);

// The markup this mounts into is made rather than found — see
// `mount-point.ts`. This used to look up an id that came from an `index.html`
// this shell had of its own, and there is no second file any more: Domicile
// writes the document and writes no such element, so every launch threw here
// before React was reached and the desktop was a white window.
createRoot(mountPoint(document)).render(
  <Shell appElements={appElements} bridge={bridge} displays={displays} />,
);

// The compositor logs its own half of the frame path every 5s; this is the
// other half, on the same cadence and in the same shape, so the two lines can
// be read side by side. It is the number behind "sluggish": everything between
// pressing a key and seeing it, including the client's own redraw and
// `putImageData`. That line is silent when nothing was typed — so is the
// compositor's for an idle desktop.
//
// The round trip is reported alongside the two stages inside it that the
// compositor cannot see, so a large total can be attributed rather than just
// observed: `ipc` is what the host's bytes cost between arriving in this
// process and reaching this page, and `draw` is putting them on the canvas.
//
// Placement is reported on a line of its own, because it is not part of the
// round trip at all: it is the one cost that grows with the number of windows
// rather than with what any of them is doing. See `diagnostic-lines`.
//
// Straight to the console, where it used to cross an IPC channel to an
// Electron main process: the page could not reach a terminal from inside the
// renderer's isolated world, and the preload was the only thing that could.
// The engine has no world boundary, and what a page logs reaches the terminal
// it was started from.
setInterval(() => {
  // Every window is drained on every interval, whether or not anything is
  // printed: a window left undrained accumulates across the whole session,
  // and the next line to include it would report an average since startup
  // rather than since the last line.
  const lines = diagnosticLines({
    draw: appElements.drawTiming.take(),
    ipc: bridge.hop.take(),
    place: placementTiming.take(),
    // Not drained: the round trip is reported for the whole run, so the
    // last line printed is the answer rather than whichever few seconds a
    // reader's `tail` happened to catch.
    trip: bridge.roundTrip.report(performance.now()),
  });
  for (const line of lines) {
    // biome-ignore lint/suspicious/noConsole: this line *is* the report
    console.log(line);
  }
}, REPORT_EVERY_MS);

// The handshake's failure is a value, so it is reported rather than thrown:
// this used to `.catch` and rethrow, which inside a promise handler is an
// unhandled rejection — the desktop failed to start and said so nowhere a user
// would look. A version mismatch is the compositor and the chrome having been
// built from different commits, which is worth naming precisely.
//
// The trailing `.catch` is not for `connect()`, which cannot reject: its only
// other failure is a `transport.send` that throws, and that happens
// synchronously inside `connect()` before this chain exists. It is for the
// handler above — the `Ok` arm sends, and a throw there rejects the promise
// `.then` returns. Only a `.catch` after it sees that; an `onRejected` passed
// to the same `.then` is wired to `connect()`'s rejections and never fires.
bridge
  .connect()
  .then((agreed) => {
    agreed.match({
      Err: (failure) => {
        // biome-ignore lint/suspicious/noConsole: the desktop has not started
        console.error(`domicile: ${describeHandshakeFailure(failure)}`);
        // There used to be a second half here: the same line on stderr,
        // followed by ending the process. Both were the Electron main
        // process's — a page can do neither — and reached over an IPC channel
        // the preload injected. The engine has no such channel and the page
        // has no process to end; what it says on the console is what reaches
        // the terminal, which is the reporting half and all of it that a page
        // was ever able to do.
      },
      Ok: () => {
        // After the handshake: the host ignores everything sent before it.
        reportDevicePixelRatio(bridge, window);
      },
    });
  })
  .catch((failure: unknown) => {
    // biome-ignore lint/suspicious/noConsole: the desktop has not started
    console.error("domicile: the handshake could not be completed", failure);
  });
