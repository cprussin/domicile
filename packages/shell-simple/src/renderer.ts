// Entry point for the simple shell's renderer, and the whole of its wiring.
//
// `connectToHost` finds the compositor whichever way this page was opened —
// the fork, or a plain browser with no desktop at all — and this joins the SDK
// to it, puts a window on the desktop for every client the host announces, and
// hands the pointer to `installWindowGestures`. There is nothing else — no
// chrome around the windows, and no state that is not a window's box. The keys
// go on the background behind them; what a window paints of its own is
// `desktop.ts`'s.

import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";
import { reportDesktopSize } from "@domicile/chrome-sdk/desktop-size";
import { reportDevicePixelRatio } from "@domicile/chrome-sdk/device-pixel-ratio";
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

import { endCatchUpOnFocusChange } from "./catch-up";
import { Desktop } from "./desktop";
import { installKeybindingBackground } from "./keybinding-background";
import { openTerminalOnAltEnter } from "./terminal-shortcut";
import { installWindowGestures } from "./window-gestures";

import "./global.css";

// One call, two places. Under the fork this is `navigator.domicile`, the
// control channel the engine puts on a document it served; in a plain browser
// there is none, and `connectToHost` says so on the console and hands back a
// stand-in that does nothing — so the desktop still opens and the gestures
// still work against windows that will never arrive.
const domicile = new DomicileClient(connectToHost(navigator));
registerElements(domicile);

// The one thing an empty desktop has to say — this shell is Alt and nothing
// else. Before the windows rather than anywhere: what unpaints it over one is
// a following-sibling selector, so it hides only for windows appended after
// it.
installKeybindingBackground(document.body);

const desktop = new Desktop(document.body);
installWindowGestures(document.body, desktop);
// The one thing this shell claims the keyboard for: without a way to start a
// terminal, nothing can reach the desktop except from outside Domicile.
openTerminalOnAltEnter(domicile, document.body);

domicile.on("app_appeared", ({ app_id, size }) => {
  desktop.open(app_id, size);
});
domicile.on("app_closed", ({ app_id }) => {
  desktop.close(app_id);
});
domicile.on("app_resized", (message) => {
  desktop.resizeSurface(message);
});
domicile.on("app_cursor", (message) => {
  desktop.applyCursor(message);
});
// And when the host has finished describing what was already running, which is
// what makes the next window to appear one someone opened.
endCatchUpOnFocusChange(domicile, desktop);

// Both halves of the desktop's mode, sent as soon as there is anything to send
// them to. There is no handshake to wait for any more — a shell used to defer
// these until `welcome` arrived, because the host dropped everything before it,
// and the control channel has no such moment: the first call binds it.
//
// The density is what a client renders at; the size is how big the desktop
// *is*, and under the forked engine the compositor cannot see the window this
// page is in — without the second call the desktop stays at the compositor's
// configured `nested_size` however large the window really is.
reportDevicePixelRatio(domicile, window);
reportDesktopSize(domicile, window);
