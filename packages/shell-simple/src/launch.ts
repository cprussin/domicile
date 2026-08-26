// The simple shell, as the user runs it.
//
// `simple` on the command line reaches here. This starts the compositor, then
// starts the chrome's own Electron process on the display the compositor made
// for it — in that order, because Electron settles which display it draws on
// while it starts up, and until the compositor is up there is no answer.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchShell } from "@domicile/electron-chrome-host/launch-shell";

import { configPath, parseShellConfig } from "./shell-config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// biome-ignore lint/style/noProcessEnv: the launcher is node; this is its only env source.
const environment = process.env;

/**
 * This shell's configuration, or its defaults where there is no file.
 *
 * A missing file is a first run rather than a mistake — the shell has working
 * defaults and says so by starting. A file that will not *parse* is neither,
 * and `parseShellConfig` refuses it.
 */
const configured = async (): Promise<ReturnType<typeof parseShellConfig>> => {
  const file = configPath(environment);
  const text = await readFile(file, "utf8").catch(
    (cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") {
        return "{}";
      } else {
        // A directory where the file should be, a mode nothing can read: not
        // a first run, and not something to start on defaults through.
        throw cause;
      }
    },
  );
  return parseShellConfig(text);
};

/** Start the desktop, and report the status it ended with. */
const run = async (): Promise<number> => {
  const { desktop, present } = await configured();
  return launchShell({
    config: desktop,
    main: path.join(dirname, "main.js"),
    present,
  });
};

// Caught rather than left to the runtime. A rejected top-level `await` is an
// unhandled rejection, and what a runtime does with one is its own business —
// Electron pins Node's legacy `--unhandled-rejections=warn`, where the reason
// goes to a stderr nobody reads and the process exits 0. A desktop that did
// not start must say so and exit non-zero, whichever Node it is running in.
process.exitCode = await run().catch((cause: unknown) => {
  process.stderr.write(`${String(cause)}\n`);
  return 1;
});
