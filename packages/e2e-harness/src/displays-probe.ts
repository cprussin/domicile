// biome-ignore-all lint/suspicious/noConsole: what it reports is its output

// Reports the desktop a real chrome is told about over a real socket.
//
// Driven by scripts/e2e-displays-on-hello.sh. The chrome is one page spanning
// every display, and a display is a region of it — so `<Screen name="left">`
// is only possible if the layout actually crosses the wire. Unit tests pin
// each half (the config normalises, the host answers `hello` with the list,
// the schema decodes it); nothing but this pins that a compositor started on
// a two-display config tells a chrome about two displays.

import type { DisplayInfo } from "@domicile/chrome-sdk/protocol";

import { connectChromeSocket, requireSocketPath } from "./chrome-socket";
import { asDesktopReport } from "./desktop-line";
import { settle } from "./waiting";

/** How long to wait for the handshake to be answered before giving up. */
const SETTLE_MS = 600;

/**
 * The desktop as described, `undefined` meaning never described at all.
 *
 * The distinction is the point: a host that described a desktop of no screens
 * and one that never spoke both print an empty line otherwise, and only one of
 * them is a bug in what this script is about. {@link asDesktopReport} keeps
 * them apart.
 */
let described: readonly DisplayInfo[] | undefined;

connectChromeSocket(requireSocketPath(Bun.env), {
  onMessage: (message) => {
    if (message.type === "displays") {
      described = message.displays;
    }
  },
});

await settle(SETTLE_MS, () => described !== undefined);
console.log(`displays: ${asDesktopReport(described)}`);
process.exit(0);
