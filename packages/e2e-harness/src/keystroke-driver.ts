// Driven by scripts/measure.sh: focus the first window that appears and type
// into it at a steady rate, so the compositor's `response_ms` and the chrome's
// `rt_ms` are measured against a known number of keystrokes rather than
// whatever someone happened to type.
//
// Spaced on purpose. A burst is one round trip by both measurements — they take
// the oldest unanswered keystroke, because the felt lag is how long the first
// character waited — so keys sent faster than a client can redraw would be
// counted once and report a number nobody experiences.

import {
  focusAppMessage,
  keyMessage,
} from "@domicile/chrome-sdk/chrome-message";

import type { ChromeSocket } from "./chrome-socket";
import { connectChromeSocket, requireSocketPath } from "./chrome-socket";

/** evdev `a`. A printable character, so a terminal redraws for it. */
const KEY_A = 30;

/** Long enough that each keystroke is its own round trip on any sane client. */
const BETWEEN_KEYS_MS = 250;

/**
 * How long to let a client settle before typing at it. kitty takes seconds
 * between mapping its window and its first frame — font cache, GPU init, shader
 * compile — and keys sent into that would be timed against work that happens
 * once.
 */
const SETTLE_MS = 9000;

/** How many keystrokes to send, as an argument: `keystroke-driver.ts 40`. */
const keystrokes = Number(Bun.argv[2] ?? "40");
if (!Number.isInteger(keystrokes) || keystrokes < 1) {
  throw new TypeError(
    `keystroke-driver: ${String(Bun.argv[2])} is not a count`,
  );
}

let driving = false;

/**
 * A window that never appears must not leave this running forever. The script
 * that spawns it waits on it, so a client that failed to start would hang the
 * measurement rather than report that nothing was measured.
 */
setTimeout(() => {
  if (!driving) {
    process.stderr.write("keystroke-driver: no window ever appeared\n");
    process.exit(1);
  }
}, SETTLE_MS + 30_000);

const chrome: ChromeSocket = connectChromeSocket(requireSocketPath(Bun.env), {
  onMessage: (message) => {
    if (message.type === "app_appeared") {
      // Not `void`: ERRORS.md wants a rejection path on a fire-and-forget
      // unconditionally, and `drive` is one — it waits out the settle and then
      // sends a keystroke a frame at a time. Swallowed, anything that rejects
      // in there leaves a run that stopped early looking like a measurement,
      // and this script is the one `measure.sh` reads its numbers from.
      drive(message.app_id).catch((failure: unknown) => {
        process.stderr.write(
          `keystroke-driver: could not drive ${message.app_id}: ${String(failure)}\n`,
        );
        process.exit(1);
      });
    }
  },
});

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function drive(appId: string): Promise<void> {
  if (driving) {
    return;
  }
  driving = true;
  await sleep(SETTLE_MS);
  chrome.send(focusAppMessage(appId));
  for (let sent = 0; sent < keystrokes; sent++) {
    chrome.send(keyMessage(appId, KEY_A, true));
    chrome.send(keyMessage(appId, KEY_A, false));
    await sleep(BETWEEN_KEYS_MS);
  }
  // Not immediately: both reports are on a 5s cadence, so the last keystrokes
  // are only in a line that has yet to be printed.
  await sleep(6000);
  chrome.close();
  process.exit(0);
}
