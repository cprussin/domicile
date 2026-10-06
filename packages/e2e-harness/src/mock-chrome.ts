// biome-ignore-all lint/suspicious/noConsole: this harness's whole output is the frames it prints

// Headless chrome for `scripts/e2e-dmabuf.sh`. It prints every frame the host
// pushes so the script can assert on frames from a real GPU.

import { setDevicePixelRatioMessage } from "./chrome-message";

import {
  connectChromeSocket,
  devicePixelRatio,
  listenWindowMs,
  requireSocketPath,
} from "./chrome-socket";

// A GPU client can take many seconds to produce its first frame, so the
// caller sets the window.
const LISTEN_MS = listenWindowMs(Bun.env);

const chrome = connectChromeSocket(requireSocketPath(Bun.env), {
  onFrame: (frame) => {
    console.log(frame);
  },
});

// There is no display, so report a ratio only if the script set one.
const ratio = devicePixelRatio(Bun.env);
if (ratio !== undefined) {
  chrome.send(setDevicePixelRatioMessage(ratio));
}

setTimeout(() => {
  chrome.close();
  process.exit(0);
}, LISTEN_MS);
