// biome-ignore-all lint/suspicious/noConsole: this harness's whole output is the frames it prints

// Headless stand-in for the chrome, driven by scripts/e2e-chrome.sh: connect to
// the compositor's chrome socket, complete the handshake, and print every frame
// the host pushes so the calling script can assert on them.

import {
  connectChromeSocket,
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

setTimeout(() => {
  chrome.close();
  process.exit(0);
}, LISTEN_MS);
