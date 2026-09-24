// The shell's entry point: the SDK wired to whatever host this page was opened
// under, and the React chrome mounted on top of it.

import { connectToHost, hasHost } from "@domicile/chrome-sdk/connect-to-host";
import { reportDesktopSize } from "@domicile/chrome-sdk/desktop-size";
import { reportDevicePixelRatio } from "@domicile/chrome-sdk/device-pixel-ratio";
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import {
  applyPreference,
  loadPreference,
} from "@domicile/component-library/ThemeProvider";
import { createRoot } from "react-dom/client";

import { mountPoint } from "./mount-point";
import { Shell } from "./Shell";
import { hostDisplays } from "./screens/host-displays";
import { viewportDisplays } from "./screens/viewport-displays";
import { deskChannel } from "./window-management/desk-channel";

import "./global.css";

// The persisted (or system) theme, before React mounts, so the first paint uses
// the right semantic-token values. There is no paint before this: the
// stylesheet travels inside this module rather than in a render-blocking
// `<link>`, which is what ends this shell's theme flash — see
// `@domicile/component-library/vite-shell`.
applyPreference(loadPreference());

// One call, two places. Under the fork this is `window.domicile`, the
// control channel the engine puts on a document it served; in a plain browser
// there is none, and `connectToHost` says so on the console and hands back a
// stand-in that does nothing — so the shell still opens for styling work
// against a desktop that will never arrive.
const domicile = new DomicileClient(connectToHost(window));

// And where the desktop comes from, which is the same question one answer
// later: a host describes one, and with no host nothing ever will, so the
// window is the only geometry there is. Built here rather than in the chrome
// because this is where the host's absence is already known, and once rather
// than per render because a source is the connection.
const displays = hasHost(window)
  ? hostDisplays(domicile)
  : viewportDisplays(window);
registerElements(domicile);

// And the other pages of this desk. A desk of several monitors is several
// windows of this same shell — one browser window cannot span two CRTCs — with
// one desktop between them: `window-management/desk-channel.ts` is how they
// stay one. Built here for the same reason the display source is: it is a
// connection, and this is where a connection is made.
const desk = deskChannel();

createRoot(mountPoint(document)).render(
  <Shell desk={desk} displays={displays} domicile={domicile} />,
);

// Both halves of the desktop's mode, sent as soon as the shell is mounted.
//
// The density is what a client renders at; the size is how big the desktop
// *is*, and under the forked engine the compositor cannot see the window this
// page is in — without the second call the desktop stays at the compositor's
// startup placeholder however large the window really is.
reportDevicePixelRatio(domicile, window);
reportDesktopSize(domicile, window);
