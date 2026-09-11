// Entry point for the shell's renderer. `connectToHost` finds the compositor
// whichever way this page was opened — the fork, or a plain browser with no
// desktop at all — and this wires the SDK to it and mounts the React chrome on
// top.

import { connectToHost, hasHost } from "@domicile/chrome-sdk/connect-to-host";
import { reportDesktopSize } from "@domicile/chrome-sdk/desktop-size";
import { reportDevicePixelRatio } from "@domicile/chrome-sdk/device-pixel-ratio";
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { placementTiming } from "@domicile/chrome-sdk/placement-timing";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import {
  applyPreference,
  loadPreference,
} from "@domicile/component-library/ThemeProvider";
import { createRoot } from "react-dom/client";
import { displaysFrom } from "./display-source";
import { mountPoint } from "./mount-point";
import { placementLine } from "./placement-line";
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

// One call, two places. Under the fork this is `navigator.domicile`, the
// control channel the engine puts on a document it served; in a plain browser
// there is none, and `connectToHost` says so on the console and hands back a
// stand-in that does nothing — so the shell still opens for styling work
// against a desktop that will never arrive.
const domicile = new DomicileClient(connectToHost(navigator));

// And where the desktop comes from, which is the same question one answer
// later: a host describes one, and with no host nothing ever will, so the
// window is the only geometry there is. Built here rather than in the chrome
// because this is where the host's absence is already known, and once rather
// than per render because a source is the connection.
const displays = hasHost(navigator)
  ? displaysFrom(domicile)
  : viewportDisplays(window);
registerElements(domicile);

// The markup this mounts into is made rather than found — see
// `mount-point.ts`. This used to look up an id that came from an `index.html`
// this shell had of its own, and there is no second file any more: Domicile
// writes the document and writes no such element, so every launch threw here
// before React was reached and the desktop was a white window.
createRoot(mountPoint(document)).render(
  <Shell displays={displays} domicile={domicile} />,
);

// What this chrome costs a desktop that is doing nothing: every window is
// measured on every animation frame to keep its client configured at the box
// the page gives it, and nothing else here is paid per frame. Reported on the
// compositor's own cadence so the two logs can be read side by side, and
// silent on an interval that measured nothing — so is the compositor's for an
// idle desktop.
//
// **The keystroke line that used to print beside it is gone.** Keystroke to
// pixel is measured in `domicile-compositor`'s `latency.rs` now, and the three
// instruments this line read it off had stopped recording when a client's
// buffer stopped passing through this page — see `placement-line.ts`.
//
// Straight to the console, where it used to cross an IPC channel to an
// Electron main process: the page could not reach a terminal from inside the
// renderer's isolated world, and the preload was the only thing that could.
// The engine has no world boundary, and what a page logs reaches the terminal
// it was started from.
setInterval(() => {
  // Drained on every interval, whether or not anything is printed: a window
  // left undrained accumulates across the whole session, and the next line to
  // include it would report an average since startup rather than since the
  // last line.
  const line = placementLine(placementTiming.take());
  if (line !== undefined) {
    // biome-ignore lint/suspicious/noConsole: this line *is* the report
    console.log(line);
  }
}, REPORT_EVERY_MS);

// Both halves of the desktop's mode, sent as soon as the shell is mounted.
//
// This used to wait for a `welcome`, because the host dropped everything a
// chrome said before the handshake — and the waiting was a promise chain with
// two error arms, one for the version mismatch and one for a throw inside the
// handler that reported it. The control channel has no handshake at all: the
// version check happens in the browser process and only logs, and the first
// call is what binds the channel. So there is nothing to await and nothing to
// report, and what is left is the two calls that were always the point.
//
// The density is what a client renders at; the size is how big the desktop
// *is*, and under the forked engine the compositor cannot see the window this
// page is in — without the second call the desktop stays at the compositor's
// configured `nested_size` however large the window really is.
reportDevicePixelRatio(domicile, window);
reportDesktopSize(domicile, window);
