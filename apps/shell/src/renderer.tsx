// Entry point for the shell's renderer. The compositor loads the built
// index.html, injects a transport at `window.domicileTransport`, and this wires
// the SDK to it and mounts the React chrome on top.

import {
  BridgeClient,
  describeHandshakeFailure,
} from "@domicile/chrome-sdk/bridge";
import { placementTiming } from "@domicile/chrome-sdk/placement-timing";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import {
  applyPreference,
  loadPreference,
} from "@domicile/component-library/ThemeProvider";
import { createRoot } from "react-dom/client";

import { AppElements } from "./app-elements";
import { diagnosticLines } from "./diagnostic-lines";
import { Shell } from "./Shell";

import "./global.css";

/** Matches the compositor's reporting interval so the two lines interleave. */
const REPORT_EVERY_MS = 5000;

// Apply the persisted (or system) theme before React mounts so the first paint
// uses the right semantic-token values. (`index.html` runs an inline copy of
// this for the pre-bundle paint; this call covers the rest of the chrome.)
applyPreference(loadPreference());

// The host exposes a transport (send/onMessage) to the page. Fall back to a
// no-op so the shell can be opened in a plain browser for styling work.
const transport = window.domicileTransport ?? {
  onMessage: () => undefined,
  send: () => undefined,
};

const bridge = new BridgeClient(transport);
const appElements = new AppElements();
registerElements(bridge);

// The markup this entry point mounts into is its own file, so a missing id is
// a mismatch between the two rather than a condition to handle.
const container = document.getElementById("root");
if (container === null) {
  throw new Error("shell: index.html is missing #root");
} else {
  createRoot(container).render(
    <Shell appElements={appElements} bridge={bridge} />,
  );
}

// The compositor logs its own half of the frame path every 5s; this is the
// other half, on the same cadence and in the same shape, so the two lines can
// be read side by side. It is the number behind "sluggish": everything between
// pressing a key and seeing it, including the client's own redraw and
// `putImageData`. That line is silent when nothing was typed — so is the
// compositor's for an idle desktop. Outside Electron (the shell opened in a
// plain browser for styling work) there is nowhere to print, so there is no
// report either.
// The round trip is reported alongside the two stages inside it that the
// compositor cannot see, so a large total can be attributed rather than just
// observed: `ipc` is what the host's bytes cost between arriving in this
// process and reaching this page, and `draw` is putting them on the canvas.
//
// Placement is reported on a line of its own, because it is not part of the
// round trip at all: it is the one cost that grows with the number of windows
// rather than with what any of them is doing. See `diagnostic-lines`.
const diagnostics = window.domicileDiagnostics;
if (diagnostics !== undefined) {
  setInterval(() => {
    // Every window is drained on every interval, whether or not anything is
    // printed: a window left undrained accumulates across the whole session,
    // and the next line to include it would report an average since startup
    // rather than since the last line.
    const lines = diagnosticLines({
      draw: appElements.drawTiming.take(),
      ipc: bridge.hop.take(),
      place: placementTiming.take(),
      trip: bridge.roundTrip.take(),
    });
    for (const line of lines) {
      diagnostics.report(line);
    }
  }, REPORT_EVERY_MS);
}

// A client can only draw at the display's real resolution if the compositor
// knows what that is, and the page is the only part of Domicile that does.
// `resolution:` matches at exactly the current ratio, so the listener fires on
// any change — moving the window to another display, or a browser zoom — and
// is re-armed against the new one.
const reportDevicePixelRatio = (): void => {
  bridge.setDevicePixelRatio(window.devicePixelRatio);
  window
    .matchMedia(`(resolution: ${window.devicePixelRatio.toString()}dppx)`)
    .addEventListener("change", reportDevicePixelRatio, { once: true });
};

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
      },
      Ok: () => {
        // After the handshake: the host ignores everything sent before it.
        reportDevicePixelRatio();
      },
    });
  })
  .catch((failure: unknown) => {
    // biome-ignore lint/suspicious/noConsole: the desktop has not started
    console.error("domicile: the handshake could not be completed", failure);
  });
