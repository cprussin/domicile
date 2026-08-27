// biome-ignore-all lint/suspicious/noConsole: the transcript it prints is its whole output

// Driven by scripts/e2e-modifiers.sh: hold a modifier and watch what the
// compositor says about it.
//
// A chrome cannot see this for itself. `wl_keyboard.modifiers` goes to the
// surface that holds the keyboard, so once a window is focused the page stops
// hearing about the Alt the user is holding — which is exactly when a shell
// wants to know, because that is when it would begin an alt-drag. So the
// compositor tells every chrome, and this is what proves it does.
//
// Three things are being asked, and the transcript is all three at once: that
// a modifier going down and coming up are each a message; that the ordinary
// keys pressed in between are not (a page told on every keystroke is reading a
// keystroke counter); and that a chrome which reloads mid-press is told the
// modifier is no longer held. That last one is the failure with no way back —
// a page that heard Alt go down and never heard it come up drags the next
// window the user clicks, for as long as it is running.

import { helloMessage, keyMessage } from "@domicile/chrome-sdk/chrome-message";

import type { ChromeSocket } from "./chrome-socket";
import { connectChromeSocket, requireSocketPath } from "./chrome-socket";
import { rest } from "./waiting";

/** evdev 56 is the left Alt key; 28 is Enter. */
const ALT = 56;
const ENTER = 28;

/**
 * Whose keys these are. The compositor drops the app id on a `key` — the seat
 * has one keyboard, and what it types into is whatever holds the focus — so
 * this only has to be a name.
 */
const APP = "probe";

/** Long enough for each key to reach the compositor before the next one. */
const STEP_MS = 400;

/** How many `modifiers` messages this sequence is due, in total. */
const DUE = 4;

/** How long to wait for the last of them before giving up on it. */
const SETTLE_MS = 5000;

/**
 * What the compositor has said, in order, which is the whole verdict.
 *
 * Printed rather than attributed to the key that caused each one. That would
 * be a finer answer and a wrong one: a message is written when the
 * compositor's loop reaches it, so a check reading it against the step the
 * probe happened to be sleeping in fails on a slow machine rather than on a
 * broken one.
 */
const said: string[] = [];

/** Resolved by the `welcome` that answers the handshake. */
const { promise: welcomed, resolve: welcome } = Promise.withResolvers<void>();

/** Resolved once everything this sequence is due has arrived. */
const { promise: complete, resolve: allSaid } = Promise.withResolvers<void>();

const chrome: ChromeSocket = connectChromeSocket(requireSocketPath(Bun.env), {
  onMessage: (message) => {
    if (message.type === "welcome") {
      welcome();
    }
    if (message.type === "modifiers") {
      const line = `modifiers: alt=${String(message.alt)} ctrl=${String(message.ctrl)} shift=${String(message.shift)} logo=${String(message.logo)}`;
      said.push(line);
      console.log(line);
      if (said.length === DUE) {
        allSaid();
      }
    }
  },
});

const press = async (keycode: number, pressed: boolean): Promise<void> => {
  chrome.send(keyMessage(APP, keycode, pressed));
  await rest(STEP_MS);
};

// The handshake has to land before the first key does. `connectChromeSocket`
// sends `hello` from the connect callback, and a write issued before the
// socket connects is queued and flushed ahead of it — so a sequence that
// starts the moment this module runs sends its first key before the
// compositor has a chrome to send it to, and everything that arrives before
// the handshake is dropped.
await welcomed;

await press(ALT, true);

// Ordinary keys, held modifier unchanged. Nothing is due for either half.
await press(ENTER, true);
await press(ENTER, false);

await press(ALT, false);

// And again, this time never let go: the reload is what ends it.
await press(ALT, true);

// `hello` is what a page sends when its bundle starts, so it arrives again
// after a reload or a crash-and-recreate whatever the socket did — which is
// the compositor's one signal that everything the old page was holding is
// gone, the keys included.
chrome.send(helloMessage());

// Waited for rather than assumed. A message that arrives after this process
// exits is one the script reads as never sent, which convicts the compositor
// of the very bug this exists to rule out — and the wait ends either way, so
// a compositor that says nothing is still reported by the script rather than
// hanging here.
await Promise.race([complete, rest(SETTLE_MS)]);

chrome.close();
process.exit(0);
