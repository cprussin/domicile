// biome-ignore-all lint/suspicious/noConsole: this harness's whole output is the frames it prints

// Headless stand-in for the chrome, driven by scripts/e2e-dmabuf.sh and
// scripts/e2e-hidpi.sh: connect to the compositor's chrome socket, complete
// the handshake, and print every frame the host pushes so the calling script
// can assert on them.
//
// `e2e-chrome.sh` drove it too, until that script's four claims each got a
// killer in `cargo test` and it went. What is left here is what needs a frame
// out of a real GPU or at a real density — neither of which the Rust suite has.

import { setDevicePixelRatioMessage } from "@domicile/chrome-sdk/chrome-message";

import {
  connectChromeSocket,
  devicePixelRatio,
  listenWindowMs,
  requireSocketPath,
} from "./chrome-socket";

// A GPU client can be many seconds from launch to its first frame, so the
// window is the caller's to set.
const LISTEN_MS = listenWindowMs(Bun.env);

const chrome = connectChromeSocket(requireSocketPath(Bun.env), {
  onFrame: (frame) => {
    console.log(frame);
  },
});

// A real chrome reports the density of the display it is painting on; this one
// reports whatever the calling script wants to test with, and nothing at all
// otherwise — a headless harness has no display to be honest about.
const ratio = devicePixelRatio(Bun.env);
if (ratio !== undefined) {
  chrome.send(setDevicePixelRatioMessage(ratio));
}

setTimeout(() => {
  chrome.close();
  process.exit(0);
}, LISTEN_MS);
