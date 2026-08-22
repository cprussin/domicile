// biome-ignore-all lint/suspicious/noConsole: this harness's whole output is the messages it prints

// Driven by scripts/e2e-close.sh: connect to the compositor's chrome socket and
// ask the first client that appears to close its window — what the X on a
// native window's tab does — then print what the host says next.
//
// The point is the two halves of that: the client is *asked*, and the chrome is
// told when it actually went. Nothing here ends the client; if it decided to
// stay, `app_closed` never arrives and the script says so.

import { closeAppMessage } from "@domicile/chrome-sdk/chrome-message";
import type { ChromeSocket } from "./chrome-socket";
import { connectChromeSocket, requireSocketPath } from "./chrome-socket";

/** How long to wait for a client that never appears, or never goes. */
const RUN_MS = 10_000;

let asked = false;

const chrome: ChromeSocket = connectChromeSocket(requireSocketPath(Bun.env), {
  onMessage: (message) => {
    // Frames are the window's pixels; everything else is a line the script can
    // assert on.
    if (message.type !== "app_frame") {
      console.log(JSON.stringify(message));
    }
    // On the announcement rather than on a frame: a toplevel exists from the
    // moment it maps, which is what a close is sent to, and a client that
    // never draws is still one the user can close.
    if (message.type === "app_appeared" && !asked) {
      asked = true;
      chrome.send(closeAppMessage(message.app_id));
    }
    // Done the moment the window is gone, so the script's `wait` returns
    // promptly and with everything printed — a probe killed mid-run takes its
    // unflushed stdout with it.
    if (message.type === "app_closed") {
      chrome.close();
      process.exit(0);
    }
  },
});

setTimeout(() => {
  chrome.close();
  process.exit(0);
}, RUN_MS);
