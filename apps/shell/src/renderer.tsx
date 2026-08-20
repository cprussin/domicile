// Entry point for the shell's renderer. The compositor loads the built
// index.html, injects a transport at `window.domicileTransport`, and this wires
// the SDK to it and mounts the React chrome on top.

import { BridgeClient } from "@domicile/chrome-sdk/bridge";
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
// observed: `ipc` is the main-process → renderer hop, where a frame's pixels
// are structured-cloned across a process boundary, and `draw` is putting them
// on the canvas.
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
      ipc: diagnostics.takeIpcHop(),
      place: placementTiming.take(),
      trip: bridge.roundTrip.take(),
    });
    for (const line of lines) {
      diagnostics.report(line);
    }
  }, REPORT_EVERY_MS);
}

// The compositor watches this attribute to know the chrome finished its
// handshake; a failed handshake must surface rather than leave it unset
// silently, so the rejection is rethrown out of the microtask.
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

bridge
  .connect()
  .then(() => {
    document.body.dataset.domicileConnected = "true";
    // After the handshake: the host ignores everything sent before it.
    reportDevicePixelRatio();
  })
  .catch((error: unknown) => {
    throw new Error("domicile: bridge handshake failed", { cause: error });
  });
