// A chrome that connects, handshakes, and then never reads again — the shape of
// a chrome that has fallen behind, or wedged. Driven by
// scripts/e2e-slow-chrome.sh, which checks the compositor survives it.
//
// It reads nothing on purpose, so the compositor's socket buffer fills and any
// write to it blocks. A compositor that writes frames from its Wayland loop
// stops serving every client at that point, not just this one.

import net from "node:net";

import { helloMessage } from "@domicile/chrome-sdk/chrome-message";
import { withFrameDelimiter } from "@domicile/chrome-sdk/newline-frames";

import { requireSocketPath } from "./chrome-socket";

const HOLD_MS = 30_000;

const socket = new net.Socket();

// Teardown is a kill from the calling script, so a reset at the end is the
// expected finish rather than a failure worth reporting.
socket.on("error", () => undefined);

socket.connect(requireSocketPath(Bun.env), () => {
  socket.write(withFrameDelimiter(JSON.stringify(helloMessage())));
  // Attaching no `data` listener is what keeps the socket unread; `pause` says
  // so explicitly rather than relying on that absence.
  socket.pause();
});

setTimeout(() => {
  socket.destroy();
  process.exit(0);
}, HOLD_MS);
