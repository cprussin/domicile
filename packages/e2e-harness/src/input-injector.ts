// Driven by scripts/e2e-input.sh: connect to the compositor's chrome socket
// and, when an app appears, forward a focus + pointer + keyboard sequence to it.
// Proves input injection reaches a real Wayland client.

import {
  focusAppMessage,
  keyMessage,
  pointerButtonMessage,
  pointerMotionMessage,
} from "@domicile/chrome-sdk/chrome-message";
import { BTN_LEFT } from "@domicile/chrome-sdk/input";
import type { ChromeSocket } from "./chrome-socket";
import { connectChromeSocket, requireSocketPath } from "./chrome-socket";

const EVDEV_KEY_A = 30;

// The sequence waits for the client's first frame: pointer focus is only
// delivered to a client that has bound its `wl_pointer`, which happens while it
// brings its window up. In real use the mouse moves long after that. It is sent
// a second time as well, so a dropped first wave does not fail the run.
const SECOND_WAVE_MS = 1500;
const RUN_MS = 5000;

const forward = (chrome: ChromeSocket, appId: string): void => {
  chrome.send(focusAppMessage(appId));
  chrome.send(pointerMotionMessage(appId, 10, 10));
  chrome.send(pointerMotionMessage(appId, 20, 20));
  chrome.send(pointerButtonMessage(appId, BTN_LEFT, true));
  chrome.send(pointerButtonMessage(appId, BTN_LEFT, false));
  chrome.send(keyMessage(appId, EVDEV_KEY_A, true));
  chrome.send(keyMessage(appId, EVDEV_KEY_A, false));
};

let started = false;

const chrome: ChromeSocket = connectChromeSocket(requireSocketPath(Bun.env), {
  onMessage: (message) => {
    // Frames are megabytes of base64; everything else is a line the script can
    // assert on — notably the `app_cursor` a client asks for on pointer enter.
    if (message.type !== "app_frame") {
      // biome-ignore lint/suspicious/noConsole: this harness reports over stdout
      console.log(JSON.stringify(message));
    }
    if (message.type === "app_frame" && !started) {
      started = true;
      forward(chrome, message.app_id);
      setTimeout(() => {
        forward(chrome, message.app_id);
      }, SECOND_WAVE_MS);
    }
  },
});

setTimeout(() => {
  chrome.close();
  process.exit(0);
}, RUN_MS);
