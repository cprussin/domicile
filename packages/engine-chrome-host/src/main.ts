// The bridge as a program.
//
//   DOMICILE_SOCKET=/run/user/1000/domicile.sock \
//   DOMICILE_ROOT=packages/shell-simple/.vite/renderer \
//     bun packages/engine-chrome-host/src/main.ts
//
// Environment rather than flags because the only caller is a launcher, and a
// launcher that has to quote paths into an argv is a launcher with a bug in it
// the first time somebody's checkout has a space in its name.
//
// It prints where it is serving, on one line, in a shape a script can read:
// the caller needs the port and the kernel chose it.

import { serveShell } from "./serve-shell";
import { wholeNumberFromEnv } from "./whole-number-env";

// biome-ignore lint/style/noProcessEnv: this is the program; it is its own env.
const environment = process.env;

const socketPath = environment.DOMICILE_SOCKET;
const root = environment.DOMICILE_ROOT;

if (socketPath === undefined || root === undefined) {
  process.stderr.write(
    "domicile: DOMICILE_SOCKET and DOMICILE_ROOT are both required\n",
  );
  process.exit(2);
}

/** Refusing is exiting: nothing downstream can do anything useful with a
 * setting the launcher meant and got wrong. */
const refuse = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const port = wholeNumberFromEnv(
  "DOMICILE_PORT",
  environment.DOMICILE_PORT,
  refuse,
);
const reachForMs = wholeNumberFromEnv(
  "DOMICILE_REACH_MS",
  environment.DOMICILE_REACH_MS,
  refuse,
);

const serving = serveShell({
  root,
  socketPath,
  ...(port === undefined ? {} : { port }),
  // How long a page waits for a compositor that has not started yet. The
  // default suits a desktop; a CI runner starting a debug Chromium needs
  // longer, and a page whose session gave up looks exactly like a shell that
  // never joined.
  ...(reachForMs === undefined ? {} : { reachForMs }),
});

// The line run-engine.sh reads. Prefixed so that anything else this process
// says — the bridge's own complaint about a compositor that never arrived —
// cannot be mistaken for it.
process.stdout.write(`domicile: serving ${serving.url}\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    serving.stop();
    process.exit(0);
  });
}
