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

/**
 * A whole number of milliseconds, or nothing.
 *
 * `Number()` alone is not enough at this boundary and the failure is not
 * cosmetic: `Number("soon")` is `NaN`, `now() + NaN >= until` is *never* true,
 * and a reach budget of `NaN` makes the bridge retry until the process dies —
 * a page with a dead-looking transport and nothing said, which is the failure
 * `reachForMs` was added to prevent. Set-but-empty is the other trap: it reads
 * as `0`, which gives up on the first attempt.
 *
 * Refused rather than defaulted. A launcher that passed something meaningless
 * meant something by it, and quietly running with a different number is how a
 * guard measures a configuration nobody chose.
 */
const milliseconds = (
  name: string,
  raw: string | undefined,
): number | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    process.stderr.write(
      `domicile: ${name} must be a whole number of milliseconds, not ${JSON.stringify(raw)}\n`,
    );
    process.exit(2);
  }
  return value;
};

const port = milliseconds("DOMICILE_PORT", environment.DOMICILE_PORT);
const reachForMs = milliseconds(
  "DOMICILE_REACH_MS",
  environment.DOMICILE_REACH_MS,
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
