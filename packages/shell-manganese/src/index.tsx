// The shell's entry point: the SDK wired to whatever host this page was opened
// under, and the React chrome mounted on top of it.

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

import { mountPoint } from "./mount-point";
import { placementLine } from "./placement-line";
import { Shell } from "./Shell";
import { hostDisplays } from "./screens/host-displays";
import { viewportDisplays } from "./screens/viewport-displays";

import "./global.css";

/** Matches the compositor's reporting interval so the two lines interleave. */
const REPORT_EVERY_MS = 5000;

// The persisted (or system) theme, before React mounts, so the first paint uses
// the right semantic-token values. There is no paint before this: the
// stylesheet travels inside this module rather than in a render-blocking
// `<link>`, which is what ends this shell's theme flash — see
// `@domicile/component-library/vite-shell`.
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
  ? hostDisplays(domicile)
  : viewportDisplays(window);
registerElements(domicile);

createRoot(mountPoint(document)).render(
  <Shell displays={displays} domicile={domicile} />,
);

// What this chrome costs a desktop that is doing nothing: every window is
// measured on every animation frame to keep its client configured at the box
// the page gives it, and nothing else here is paid per frame. Reported on the
// compositor's own cadence so the two logs can be read side by side, and silent
// on an interval that measured nothing — so is the compositor's for an idle
// desktop.
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
// The density is what a client renders at; the size is how big the desktop
// *is*, and under the forked engine the compositor cannot see the window this
// page is in — without the second call the desktop stays at the compositor's
// configured `nested_size` however large the window really is.
reportDevicePixelRatio(domicile, window);
reportDesktopSize(domicile, window);
