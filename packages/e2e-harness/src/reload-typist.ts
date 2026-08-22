// Driven by scripts/e2e-stuck-key.sh: hold a key down, reload, and then try to
// toggle it off again.
//
// The reload is the point. A page that goes away mid-press never sends the
// release — its `keyup` goes to whatever has the keyboard next, or nowhere at
// all — and the compositor's seat is what outlives it. So the key it was
// holding stays down there, and for a lock key that is unrecoverable: xkb
// unlocks one only on the release of the press it saw lock it, and while the
// key is still down every later press is a refcount on the filter already
// holding the lock rather than a new toggle.
//
// Which key that is, is the desktop's own default: `caps:swapescape` puts
// `Caps_Lock` on evdev 1, the physical Escape key.

import {
  focusAppMessage,
  helloMessage,
  keyMessage,
  placePortalMessage,
} from "@domicile/chrome-sdk/chrome-message";

import type { ChromeSocket } from "./chrome-socket";
import { connectChromeSocket, requireSocketPath } from "./chrome-socket";

/** evdev 1. Escape on the keyboard, `Caps_Lock` in the keymap. */
const EVDEV_LOCK_KEY = 1;

/** Long enough for each step to reach the client before the next one. */
const STEP_MS = 600;

/** Where a real chrome would put the window: `focus_app` refuses an app with
 * no portal, so the placement is what makes the focus below mean anything. */
const PLACEMENT = {
  size: [500, 400] as const,
  transform: [1, 0, 0, 1, 0, 0] as const,
};

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const drive = async (chrome: ChromeSocket, appId: string): Promise<void> => {
  chrome.send(placePortalMessage({ appId, ...PLACEMENT }));
  chrome.send(focusAppMessage(appId));
  await sleep(STEP_MS);

  // Down, and never up: this is the page dying with a key held.
  chrome.send(keyMessage(appId, EVDEV_LOCK_KEY, true));
  await sleep(STEP_MS);

  // The reload. `hello` is what a page sends when its bundle starts, so it
  // arrives again after a reload or a crash-and-recreate whatever the socket
  // did — which makes it the compositor's one signal that everything the old
  // page was holding is gone.
  chrome.send(helloMessage());
  await sleep(STEP_MS);

  // And now the user presses the key again to turn caps lock off. This is the
  // whole assertion: it works, or the desktop types in capitals until it is
  // restarted.
  chrome.send(keyMessage(appId, EVDEV_LOCK_KEY, true));
  chrome.send(keyMessage(appId, EVDEV_LOCK_KEY, false));
  await sleep(STEP_MS);

  chrome.close();
  process.exit(0);
};

let driving = false;

const chrome: ChromeSocket = connectChromeSocket(requireSocketPath(Bun.env), {
  onMessage: (message) => {
    // `app_appeared` arrives again on the reload, and the second one is this
    // run in progress rather than a window to drive.
    if (message.type === "app_appeared" && !driving) {
      driving = true;
      // Not `void`: a fire-and-forget that rejects silently would leave a run
      // that stopped after the press looking like one that reached the toggle,
      // and the script would read a stuck lock as this bug rather than as a
      // harness that gave up.
      drive(chrome, message.app_id).catch((failure: unknown) => {
        process.stderr.write(`reload-typist: ${String(failure)}\n`);
        process.exit(1);
      });
    }
  },
});

// A window that never appears must not leave this running forever. Well
// inside the `timeout` the script wraps this in, whose clock starts before bun
// has finished booting: matched to it, the outer kill always won and this
// sentence — the one that says which end of the run went wrong — was never
// printed. The whole sequence takes about two and a half seconds.
const GIVE_UP_MS = 10_000;

setTimeout(() => {
  if (!driving) {
    process.stderr.write("reload-typist: no window ever appeared\n");
    process.exit(1);
  }
}, GIVE_UP_MS);
