// The bridge as a program.
//
//   DOMICILE_SOCKET=/run/user/1000/domicile.sock \
//   DOMICILE_MODULE=~/my-desktop/dist/shell.js \
//     bun packages/engine-chrome-host/src/main.ts
//
// A shell is one JavaScript module. `DOMICILE_MODULE` points at it, the
// directory it is in is what gets served, and the document it loads in is
// written here — see `shell-document.ts`. A shell built from an HTML entry is
// served with `DOMICILE_ROOT` instead, which is what the workspace's own two
// still do.
//
// Environment rather than flags because the only caller is a launcher, and a
// launcher that has to quote paths into an argv is a launcher with a bug in it
// the first time somebody's checkout has a space in its name.
//
// It prints where it is serving, on one line, in a shape a script can read:
// the caller needs the port and the kernel chose it.

import { serveShell } from "./serve-shell";
import { shellFromEnvironment } from "./shell-from-env";
import { wholeNumberFromEnv } from "./whole-number-env";

// biome-ignore lint/style/noProcessEnv: this is the program; it is its own env.
const environment = process.env;

/** Refusing is exiting: nothing downstream can do anything useful with a
 * setting the launcher meant and got wrong. */
const refuse = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

// `?? refuse(...)` rather than an `if` that calls it: `refuse` returns `never`,
// but a call in statement position does not narrow the variable, and the whole
// point of the type is that everything after this has a string.
const socketPath =
  environment.DOMICILE_SOCKET ??
  refuse("domicile: DOMICILE_SOCKET is required");

// Which shell, and where it is served from — `shell-from-env.ts`, which is
// the part of this program that is a decision rather than a side effect, and
// so the part that has tests.
const shell = await shellFromEnvironment(
  { module: environment.DOMICILE_MODULE, root: environment.DOMICILE_ROOT },
  (file) => Bun.file(file).exists(),
  refuse,
);

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
  root: shell.root,
  socketPath,
  ...(shell.module === undefined ? {} : { module: shell.module }),
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
