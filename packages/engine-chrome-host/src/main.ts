// The bridge as a program.
//
//   DOMICILE_SOCKET=/run/user/1000/domicile.sock \
//   DOMICILE_MANIFEST=~/my-desktop/domicile.json \
//     bun packages/engine-chrome-host/src/main.ts
//
// `DOMICILE_MANIFEST` is a shell that says where its parts are, and the
// document it loads in is written here — see `shell-manifest.ts`. A shell that
// built its own `index.html` is served with `DOMICILE_ROOT` instead, which is
// what the workspace's own two still do.
//
// Environment rather than flags because the only caller is a launcher, and a
// launcher that has to quote paths into an argv is a launcher with a bug in it
// the first time somebody's checkout has a space in its name.
//
// It prints where it is serving, on one line, in a shape a script can read:
// the caller needs the port and the kernel chose it.

import path from "node:path";

import { serveShell } from "./serve-shell";
import type { ShellManifestError } from "./shell-manifest";
import { readShellManifest, ShellManifestProblem } from "./shell-manifest";
import { wholeNumberFromEnv } from "./whole-number-env";

// biome-ignore lint/style/noProcessEnv: this is the program; it is its own env.
const environment = process.env;

const manifestPath = environment.DOMICILE_MANIFEST;

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

// One or the other, and the manifest wins. A caller that sets both has said
// two different things about which shell to serve, and there is no reading
// that makes it one — the same refusal `run-engine.sh` makes about a page and
// a path.
if (manifestPath !== undefined && environment.DOMICILE_ROOT !== undefined) {
  refuse(
    "domicile: DOMICILE_MANIFEST and DOMICILE_ROOT both name a shell, and" +
      " they are not the same instruction. Pass one.",
  );
}

/** What a manifest could not be, in the words the person who wrote it needs. */
const whyNot = (error: ShellManifestError): string => {
  switch (error.kind) {
    case ShellManifestProblem.NotJson: {
      return `it is not JSON: ${error.detail}`;
    }
    case ShellManifestProblem.NotAnObject: {
      return `the top level is ${error.found}, and a manifest is an object`;
    }
    case ShellManifestProblem.NoModule: {
      return 'it names no "module", so nothing says what to load';
    }
    case ShellManifestProblem.BadField: {
      return `"${error.field}" is ${error.found}`;
    }
    case ShellManifestProblem.EscapesTheShell: {
      return `"${error.field}" is ${error.path}, which is not inside the shell`;
    }
  }
};

const shell =
  manifestPath === undefined
    ? undefined
    : await (async () => {
        const file = Bun.file(manifestPath);
        if (!(await file.exists())) {
          return refuse(`domicile: there is no manifest at ${manifestPath}`);
        }
        const directory = path.dirname(path.resolve(manifestPath));
        return readShellManifest(
          await file.text(),
          path.basename(directory),
        ).match({
          Err: (error: ShellManifestError) =>
            refuse(
              `domicile: ${manifestPath} is not a shell — ${whyNot(error)}`,
            ),
          Ok: (manifest) => ({ manifest, root: directory }),
        });
      })();

const root =
  shell?.root ??
  environment.DOMICILE_ROOT ??
  refuse("domicile: one of DOMICILE_MANIFEST or DOMICILE_ROOT is required");

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
  ...(shell === undefined ? {} : { manifest: shell.manifest }),
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
