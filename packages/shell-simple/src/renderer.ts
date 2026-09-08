// Entry point for the simple shell's renderer, and the whole of its wiring.
//
// `connectToHost` finds the compositor whichever way this page was opened —
// the fork, Electron, or a plain browser with no desktop at all — and this
// joins the SDK to it, puts a window on the desktop for every client the host
// announces, and hands the pointer to `installWindowGestures`. There is nothing
// else — no chrome around the windows, and no state that is not a window's box.
// The keys go on the background behind them; what a window paints of its own is
// `desktop.ts`'s.

import {
  BridgeClient,
  describeHandshakeFailure,
} from "@domicile/chrome-sdk/bridge";
import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";
import { reportDesktopSize } from "@domicile/chrome-sdk/desktop-size";
import { reportDevicePixelRatio } from "@domicile/chrome-sdk/device-pixel-ratio";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

import { endCatchUpOnFocusChange } from "./catch-up";
import { Desktop } from "./desktop";
import { installKeybindingBackground } from "./keybinding-background";
import { openTerminalOnAltEnter } from "./terminal-shortcut";
import { installWindowGestures } from "./window-gestures";

import "./global.css";

// One call, three places. Under the fork this opens a WebSocket to the bridge
// serving this page; under Electron it takes the channel the preload injected;
// in a plain browser it does nothing at all, so the desktop still opens and the
// gestures still work against windows that will never arrive.
const bridge = new BridgeClient(
  connectToHost(window, (url) => new WebSocket(url)),
);
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
bridge.on("app_resized", (message) => {
  desktop.resizeSurface(message);
});
bridge.on("app_cursor", (message) => {
  desktop.applyCursor(message);
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
        //
        // Both halves of the desktop's mode. The density is what a client
        // renders at; the size is how big the desktop *is*, and under the
        // forked engine the compositor cannot see the window this page is in
        // — without the second call the desktop stays at the compositor's
        // configured `nested_size` however large the window really is.
        reportDevicePixelRatio(bridge, window);
        reportDesktopSize(bridge, window);
      },
    });
  })
  .catch((failure: unknown) => {
    // biome-ignore lint/suspicious/noConsole: the desktop has not started
    console.error("domicile: the handshake could not be completed", failure);
  });
