// biome-ignore-all lint/suspicious/noConsole: what it reports is its output

// Reports what *two* chromes are told about focus.
//
// Driven by scripts/e2e-two-chromes.sh. Focus is the desktop's, not one page's:
// a compositor with two chromes connected has to tell both, and a change is
// reported once — so a page that was not told has missed it for good and will
// mark the wrong window active until something else happens to connect.
//
// One chrome cannot see this. Sent to the one connection that asked and
// broadcast to every connection look identical when there is only one.

import {
  focusAppMessage,
  focusChromeMessage,
  placePortalMessage,
} from "@domicile/chrome-sdk/chrome-message";

import { connectChromeSocket, requireSocketPath } from "./chrome-socket";

/** Long enough for a message to cross the socket and be handled. */
const SETTLE_MS = 600;

const rest = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

const path = requireSocketPath(Bun.env);
/** Which of the two chromes a line belongs to. Nothing external picks one. */
type Who = "first" | "second";

const heard: Record<Who, string[]> = { first: [], second: [] };

const listening = (who: Who) =>
  connectChromeSocket(path, {
    onMessage: (message) => {
      if (message.type === "focus_changed") {
        // `undefined` is the chrome itself holding the keyboard, which is an
        // answer to print rather than a missing one.
        heard[who].push(message.app_id ?? "chrome");
      }
    },
  });

const first = listening("first");
await rest(SETTLE_MS);
const second = listening("second");
await rest(SETTLE_MS);

// The *first* chrome places and focuses a window. The second asked for none of
// this and has to hear about all of it.
first.send(
  placePortalMessage({
    appId: "app-1",
    size: [100, 100],
    transform: [1, 0, 0, 1, 0, 0],
  }),
);
first.send(focusAppMessage("app-1"));
await rest(SETTLE_MS);

// And now the *second* hands the keyboard back, which the first has to hear.
second.send(focusChromeMessage());
await rest(SETTLE_MS);

// Everything each chrome heard, catch-ups included — a chrome is told the
// current holder as it connects, so the leading entries differ between the two
// by construction and the script matches on the trailing ones.
console.log(`first: ${heard.first.join(" ")}`);
console.log(`second: ${heard.second.join(" ")}`);
process.exit(0);
