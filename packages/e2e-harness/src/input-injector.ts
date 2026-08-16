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

// The sequence is sent immediately and again after a delay, because a one-shot
// pointer enter can be missed before the client has a mapped buffer (in real
// use the mouse moves after the window is up).
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
    if (message.type === "app_appeared" && !started) {
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
