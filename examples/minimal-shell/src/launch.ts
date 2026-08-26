// The shell itself: what runs when the user runs `minimal`.
//
// This is the whole of the inversion, in one file. A shell is the program on
// the user's PATH; it starts the compositor, and the compositor is nobody
// else's business. Someone using this desktop never runs anything of
// Domicile's and never configures it directly — this shell would own that
// file if it had settings to keep in one.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchShell } from "@domicile/electron-chrome-host/launch-shell";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// The `.catch` is not optional. A rejected top-level `await` is an unhandled
// rejection, and what a runtime does with one is its own business — Electron
// pins Node's legacy `--unhandled-rejections=warn`, where the reason goes to a
// stderr nobody reads and the process exits 0. A desktop that did not start
// must say so and exit non-zero.
process.exitCode = await launchShell({
  // What this shell tells the compositor about the desktop. A real shell reads
  // its own config file and derives this; the smallest one takes the defaults.
  main: path.join(dirname, "main.js"),
  present: true,
}).catch((cause: unknown) => {
  process.stderr.write(`${String(cause)}\n`);
  return 1;
});
