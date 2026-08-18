// Driven by scripts/e2e-chrome-layer.sh: connect to the compositor's chrome
// socket and focus the first app that shows a frame, then stay connected.
//
// The point is what happens *after*: when that app's client goes away, the
// keyboard must come back to the chrome on its own. A chrome would normally ask
// for it, but a client that crashed rather than closed never gave it the chance,
// so the compositor has to be the one that guarantees it.

import { focusAppMessage } from "@domicile/chrome-sdk/chrome-message";
import type { ChromeSocket } from "./chrome-socket";
import { connectChromeSocket, requireSocketPath } from "./chrome-socket";

const RUN_MS = 15_000;

let focused = false;

const chrome: ChromeSocket = connectChromeSocket(requireSocketPath(Bun.env), {
  onMessage: (message) => {
    // On the announcement rather than on a frame: this has to be connected
    // before the window appears either way (the host does not replay what a
    // chrome missed), and an announcement arrives even for a client that never
    // draws.
    if (message.type === "app_appeared" && !focused) {
      focused = true;
      chrome.send(focusAppMessage(message.app_id));
    }
    // And once it is gone, focus it again — which is the race a real chrome
    // loses when a window closes while its focus message is in flight. The
    // keyboard must not be handed to a window that no longer exists, because
    // nothing afterwards takes it back.
    if (message.type === "app_closed") {
      chrome.send(focusAppMessage(message.app_id));
    }
  },
});

setTimeout(() => {
  chrome.close();
  process.exit(0);
}, RUN_MS);
