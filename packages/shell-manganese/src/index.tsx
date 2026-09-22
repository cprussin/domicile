// The shell's entry point: the SDK wired to whatever host this page was opened
// under, and the React chrome mounted on top of it.

import { connectToHost, hasHost } from "@domicile/chrome-sdk/connect-to-host";
import { reportDesktopSize } from "@domicile/chrome-sdk/desktop-size";
import { reportDevicePixelRatio } from "@domicile/chrome-sdk/device-pixel-ratio";
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import { standaloneThemeSource } from "@domicile/component-library/standalone-theme-source";
import {
  applyTheme,
  DEFAULT_THEME,
} from "@domicile/component-library/theme-core";
import { createRoot } from "react-dom/client";

import { mountPoint } from "./mount-point";
import { Shell } from "./Shell";
import { hostDisplays } from "./screens/host-displays";
import { viewportDisplays } from "./screens/viewport-displays";
import { hostTheme } from "./theme/host-theme";
import { rememberedTheme } from "./theme/remembered-theme";
import { deskChannel } from "./window-management/desk-channel";

import "./global.css";

// The theme this desk was last seen in, before React mounts, so the first
// paint uses the right semantic-token values. There is no paint before this:
// the stylesheet travels inside this module rather than in a render-blocking
// `<link>`, which is what ends this shell's theme flash — see
// `@domicile/component-library/vite-shell`.
//
// **A guess, and the only thing this shell keeps on the machine.** The theme
// belongs to the desktop — `[theme] mode` in the compositor's config, changed
// by the toggle on the bar, and handed to every Wayland client on the desk
// through the settings portal — and it arrives a few milliseconds from now
// with the handshake. This is what to paint in until it does, and the first
// message corrects it with the wipe. A machine that has never seen this desk
// gets dark, which is both the attribute-less state of `<html>` and what
// `[theme] mode` defaults to.
applyTheme(rememberedTheme() ?? DEFAULT_THEME);

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

// And the theme, which is the same question asked again. With a host the desk
// owns it: the toggle asks, the compositor answers every page on the desk, and
// the desk's GTK and Qt windows are told through the settings portal. With no
// host there is nobody to ask and nobody else to tell, so the toggle answers
// itself — which is what makes the shell styleable in an ordinary browser.
// Built once, outside the component, because a source is the connection.
const theme = hasHost(window)
  ? hostTheme(domicile)
  : standaloneThemeSource(rememberedTheme());
registerElements(domicile);

// And the other pages of this desk. A desk of several monitors is several
// windows of this same shell — one browser window cannot span two CRTCs — with
// one desktop between them: `window-management/desk-channel.ts` is how they
// stay one. Built here for the same reason the display source is: it is a
// connection, and this is where a connection is made.
const desk = deskChannel();

createRoot(mountPoint(document)).render(
  <Shell desk={desk} displays={displays} domicile={domicile} theme={theme} />,
);

// Both halves of the desktop's mode, sent as soon as the shell is mounted.
//
// The density is what a client renders at; the size is how big the desktop
// *is*, and under the forked engine the compositor cannot see the window this
// page is in — without the second call the desktop stays at the compositor's
// startup placeholder however large the window really is.
reportDevicePixelRatio(domicile, window);
reportDesktopSize(domicile, window);
