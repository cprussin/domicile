// biome-ignore-all lint/suspicious/noConsole: what it reports is its output

// Driven by scripts/e2e-bands.sh: declare a couple of depths, and stay
// connected while the chrome beside it answers for them.
//
// The depths are declared from here rather than by the shell whose frames
// answer, and that is a limitation of the harness rather than of the design:
// this shell declares depths when a window floats, floating one is Alt+Tab,
// and neither way of pressing it is available here. A key injected over this
// socket is forwarded to whoever holds the keyboard instead of being matched
// against the shortcuts the shell claimed, and the compositor's own keyboard
// needs a window manager's worth of X that a headless run does not have.
//
// What is under test is unaffected. The compositor holds one set of bands for
// the desktop, so it asks *every* chrome — and the shell's own `renderBands`
// answers, painting the band into the frame it commits. Everything from the
// question to the pixel and back is the real thing.

import { declareBandsMessage } from "@domicile/chrome-sdk/chrome-message";

import type { ChromeSocket } from "./chrome-socket";
import {
  connectChromeSocket,
  listenWindowMs,
  requireSocketPath,
} from "./chrome-socket";
import { rest } from "./waiting";

/** Two depths, which is the fewest that can be told apart. */
const DEPTHS = [0, 1];

/** Resolved by the `welcome` that answers the handshake. */
const { promise: welcomed, resolve: welcome } = Promise.withResolvers<void>();

const chrome: ChromeSocket = connectChromeSocket(requireSocketPath(Bun.env), {
  onMessage: (message) => {
    if (message.type === "welcome") {
      welcome();
    }
  },
});

// The handshake first: everything that arrives before it is dropped.
await welcomed;

chrome.send(declareBandsMessage(DEPTHS));
console.log(`declarer: declared ${DEPTHS.join(", ")}`);

// And stay: the bands are the desktop's, and a connection that goes away takes
// the keys it was holding with it — which makes the compositor release them,
// which is a repaint, which is a round trip nobody asked for.
await rest(listenWindowMs(Bun.env));
chrome.close();
process.exit(0);
