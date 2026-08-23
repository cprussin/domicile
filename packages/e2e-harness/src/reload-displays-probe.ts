// biome-ignore-all lint/suspicious/noConsole: what it reports is its output

// Reports every desktop a chrome is told about, not just the first.
//
// Driven by scripts/e2e-reload-displays.sh. `displays-probe.ts` answers "what
// is the desktop", which is one question with one answer and is why it exits
// as soon as it has one. This answers "what did the desktop *become*", so it
// stays connected and prints each description as it arrives — the second line
// is the whole assertion, and a probe that had already exited would never
// print it. The script's read of it is bounded, so that ends at a verdict
// rather than hanging; it ends as a compositor that never re-advertised, which
// is the wrong thing to have been told.

import type { DisplayInfo } from "@domicile/chrome-sdk/protocol";

import {
  connectChromeSocket,
  listenWindowMs,
  requireSocketPath,
} from "./chrome-socket";
import { asDesktopReport } from "./desktop-line";
import { rest } from "./waiting";

/**
 * Every description, including one that repeats.
 *
 * A probe reports what it was told; deciding which of those is interesting is
 * the script's job, one file further on. This used to skip a desktop it had
 * already printed, which is a second decision in the wrong place — and the
 * wrong way round, since the script reads the *second* line: a swallowed
 * duplicate would put the real second description there and hide the repeat
 * rather than expose it.
 *
 * No duplicate arrives today — checked, by deleting `adopt_the_desktop`'s
 * refusal to re-advertise an unchanged desktop and watching this still print
 * exactly two lines — so this is about where the decision belongs rather than
 * about a repeat anyone has seen.
 */
const report = (displays: readonly DisplayInfo[] | undefined): void => {
  console.log(`displays: ${asDesktopReport(displays)}`);
};

connectChromeSocket(requireSocketPath(Bun.env), {
  onMessage: (message) => {
    if (message.type === "displays") {
      report(message.displays);
    }
  },
});

// Long enough to outlive the rewrite the script does halfway through, and
// bounded so a compositor that never speaks again ends the run here rather
// than holding it open.
await rest(listenWindowMs(Bun.env));
process.exit(0);
