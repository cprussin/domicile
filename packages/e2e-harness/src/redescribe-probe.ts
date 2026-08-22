// biome-ignore-all lint/suspicious/noConsole: what it reports is its output

// Reports the desktop three chromes are told when it changes under them.
//
// Driven by scripts/e2e-desktop-changed.sh. With no displays configured the
// desktop is Domicile's own window, so it changes at runtime — a chrome
// reporting a denser display makes it a denser desktop. Three chromes, because
// there are three different ways to be told and each fails on its own:
//
//   witness   connected before the change and asked for none of it. Only a
//             broadcast reaches it; an answer sent to the connection that
//             asked looks identical with any smaller cast of chromes.
//   asker     sends the density. It would be told by either mechanism, which
//             is exactly why it cannot stand in for the witness.
//   latecomer connects after the change, so what it reads is the retained
//             answer rather than any message about it.
//
// Two of these were the same chrome before, which made the script pass against
// a unicast to the requester while claiming to have ruled one out.

import { setDevicePixelRatioMessage } from "@domicile/chrome-sdk/chrome-message";
import type { DisplayInfo } from "@domicile/chrome-sdk/protocol";

import { connectChromeSocket, requireSocketPath } from "./chrome-socket";
import { asDesktopReport } from "./desktop-line";
import { settle } from "./waiting";

/** How long to wait for a message to cross the socket before giving up. */
const SETTLE_MS = 800;

const path = requireSocketPath(Bun.env);
/** Which of the three chromes a description belongs to. */
type Who = "witness" | "asker" | "latecomer";

/**
 * What each chrome was last told the desktop is, `undefined` meaning it was
 * never told at all. {@link asDesktopReport} is what keeps that apart from a
 * desktop described as having no screens on it.
 */
const latest: Record<Who, readonly DisplayInfo[] | undefined> = {
  asker: undefined,
  latecomer: undefined,
  witness: undefined,
};

const listening = (who: Who) =>
  connectChromeSocket(path, {
    onMessage: (message) => {
      if (message.type === "displays") {
        // Latest wins: a chrome is told the desktop on connecting and again
        // when it changes, and what it is acting on is the last one.
        latest[who] = message.displays;
      }
    },
  });

listening("witness");
await settle(SETTLE_MS, () => latest.witness !== undefined);
const asker = listening("asker");
await settle(SETTLE_MS, () => latest.asker !== undefined);

// What each was told on connecting, so the wait below is for a *new* answer
// rather than for any answer. Identity, not contents: every message decodes to
// a fresh array, and the desktop after the change may well look the same to a
// chrome that was never reached — which is the thing being tested.
const onConnecting = { asker: latest.asker, witness: latest.witness };

// The asker reports a 2x display, which is what makes the desktop change. The
// witness asked for none of this and has to hear about all of it.
asker.send(setDevicePixelRatioMessage(2));
await settle(
  SETTLE_MS,
  () =>
    latest.witness !== onConnecting.witness &&
    latest.asker !== onConnecting.asker,
);

// And only now the third connects, so what it is told is the *current* desktop
// rather than a copy of what the others were told on connecting.
listening("latecomer");
await settle(SETTLE_MS, () => latest.latecomer !== undefined);

for (const who of ["witness", "asker", "latecomer"] as const) {
  console.log(`${who}: ${asDesktopReport(latest[who])}`);
}
process.exit(0);
