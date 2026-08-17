// Entry point for the shell's renderer. The compositor loads the built
// index.html, injects a transport at `window.domicileTransport`, and this wires
// the SDK to it and mounts the React chrome on top.

import { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import {
  applyPreference,
  loadPreference,
} from "@domicile/component-library/ThemeProvider";
import { createRoot } from "react-dom/client";

import { AppElements } from "./app-elements";
import { Shell } from "./Shell";

import "./global.css";

/** Matches the compositor's reporting interval so the two lines interleave. */
const REPORT_EVERY_MS = 5000;

// A stage that recorded nothing reads as zero, the way the compositor's line
// does: "did not run" and "took no time" are the same claim in a log line.
const round = (ms: number | undefined): string =>
  Math.round(ms ?? 0).toString();

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
// `putImageData`. Silent when nothing was typed — the compositor's line is
// silent for an idle desktop too. Outside Electron (the shell opened in a
// plain browser for styling work) there is nowhere to print, so there is no
// report either.
// The round trip is reported alongside the two stages inside it that the
// compositor cannot see, so a large total can be attributed rather than just
// observed: `ipc` is the main-process → renderer hop, where a frame's pixels
// are structured-cloned across a process boundary, and `draw` is putting them
// on the canvas.
const diagnostics = window.domicileDiagnostics;
if (diagnostics !== undefined) {
  setInterval(() => {
    const trip = bridge.roundTrip.take();
    if (trip !== undefined) {
      const ipc = diagnostics.takeIpcHop();
      const draw = appElements.drawTiming.take();
      diagnostics.report(
        [
          `round trip keys=${trip.count.toString()}`,
          `rt_ms=${round(trip.averageMs)} rt_worst_ms=${round(trip.worstMs)}`,
          `frames=${(ipc?.count ?? 0).toString()}`,
          `ipc_ms=${round(ipc?.averageMs)} ipc_worst_ms=${round(ipc?.worstMs)}`,
          `draw_ms=${round(draw?.averageMs)} draw_worst_ms=${round(draw?.worstMs)}`,
        ].join(" "),
      );
    }
  }, REPORT_EVERY_MS);
}

// The compositor watches this attribute to know the chrome finished its
// handshake; a failed handshake must surface rather than leave it unset
// silently, so the rejection is rethrown out of the microtask.
bridge
  .connect()
  .then(() => {
    document.body.dataset.domicileConnected = "true";
  })
  .catch((error: unknown) => {
    throw new Error("domicile: bridge handshake failed", { cause: error });
  });
