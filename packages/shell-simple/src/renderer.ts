// Entry point for the simple shell's renderer, and the whole of its wiring.
//
// The host injects its half of the transport at `window.domicileHost`; this
// joins the SDK to it, puts a window on the desktop for every client the host
// announces, and hands the pointer to `installWindowGestures`. There is nothing
// else — no chrome around the windows, and no state that is not a window's box.
// The keys go on the background behind them; what a window paints of its own is
// `desktop.ts`'s.

import {
  BridgeClient,
  describeHandshakeFailure,
} from "@domicile/chrome-sdk/bridge";
import { reportDevicePixelRatio } from "@domicile/chrome-sdk/device-pixel-ratio";
import { postedTransport } from "@domicile/chrome-sdk/host-transport";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

import { endCatchUpOnFocusChange } from "./catch-up";
import { Desktop } from "./desktop";
import { installKeybindingBackground } from "./keybinding-background";
import { openTerminalOnAltEnter } from "./terminal-shortcut";
import { installWindowGestures } from "./window-gestures";

import "./global.css";

// The pixels come by `postMessage` and this joins the two halves. Fall back to
// a no-op so the desktop can be opened in a plain browser, where the gestures
// still work against windows that will never arrive.
const host = window.domicileHost;
const transport =
  host === undefined
    ? { onMessage: () => undefined, send: () => undefined }
    : postedTransport(window, host);

const bridge = new BridgeClient(transport);
registerElements(bridge);

// The one thing an empty desktop has to say — this shell is Alt and nothing
// else. Before the windows rather than anywhere: what unpaints it over one is
// a following-sibling selector, so it hides only for windows appended after
// it.
installKeybindingBackground(document.body);

const desktop = new Desktop(document.body);
installWindowGestures(document.body, desktop);
// The one thing this shell claims the keyboard for: without a way to start a
// terminal, nothing can reach the desktop except from outside Domicile.
openTerminalOnAltEnter(bridge, document.body);

bridge.on("app_appeared", ({ app_id, size }) => {
  desktop.open(app_id, size);
});
bridge.on("app_closed", ({ app_id }) => {
  desktop.close(app_id);
});
bridge.on("app_frame", (message) => {
  desktop.drawFrame(message);
});
bridge.on("app_resized", (message) => {
  desktop.resizeSurface(message);
});
bridge.on("app_cursor", (message) => {
  desktop.applyCursor(message);
});
bridge.on("app_composited", (message) => {
  desktop.dropSurface(message);
});
// And when the host has finished describing what was already running, which is
// what makes the next window to appear one someone opened.
endCatchUpOnFocusChange(bridge, desktop);

// The handshake's failure is a value, so it is reported rather than thrown: a
// version mismatch is the compositor and the chrome having been built from
// different commits, which is worth naming precisely. The trailing `.catch` is
// for the handler above — `connect()` itself cannot reject.
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
        reportDevicePixelRatio(bridge, window);
      },
    });
  })
  .catch((failure: unknown) => {
    // biome-ignore lint/suspicious/noConsole: the desktop has not started
    console.error("domicile: the handshake could not be completed", failure);
  });
