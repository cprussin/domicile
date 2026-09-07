// Which shell to serve, out of the environment the launcher set.
//
// Its own module for the reason `whole-number-env.ts` is: `main.ts` is a
// program — top-level statements, `process.exit`, a server that starts — and
// nothing in it can be asked a question without running all of it. This is the
// part that is a decision rather than a side effect, so it is the part that can
// be tested, and it needs to be: it decides which directory the desktop's own
// document is served out of, and every way it can be wrong is quiet.
//
// `exists` is a parameter for the same reason `refuse` is. The one thing this
// cannot do purely is ask the disk whether a module is there, and a caller that
// supplies the answer is a caller that can test the refusal without one.

import path from "node:path";

/** Where a shell is served from, in the shape `serveShell` takes. */
export type ShellSource = {
  /** The module the written document loads, if the shell is one. */
  readonly module?: string;
  /** The directory served over HTTP. */
  readonly root: string;
};

/** What the launcher said, as the two values rather than the environment.
 *
 * Taken apart by the caller rather than read here, because `ProcessEnv` is an
 * index signature over every variable a machine happens to have and a
 * parameter typed as this one would accept none of it. Naming the two makes
 * the caller say which variables it is passing, which is the thing worth
 * reading at the call site anyway.
 */
export type NamedShell = {
  /** `DOMICILE_MODULE` — a path to the module a shell is. */
  readonly module?: string | undefined;
  /** `DOMICILE_ROOT` — a directory with a document of its own. */
  readonly root?: string | undefined;
};

/**
 * Read the shell out of what the launcher named, or refuse and say why.
 *
 * A module is served from the directory it is in, so a shell's own layout is
 * its own business: whatever it put beside its entry is reachable, and nothing
 * above that is. `static-path.ts` is what holds that line for every request.
 */
export const shellFromEnvironment = async (
  named: NamedShell,
  exists: (file: string) => Promise<boolean>,
  refuse: (message: string) => never,
): Promise<ShellSource> => {
  const modulePath = named.module;
  const root = named.root;

  // One or the other. A caller that sets both has said two different things
  // about which shell to serve, and there is no reading that makes it one —
  // the same refusal `run-engine.sh` makes about a page and a path.
  if (modulePath !== undefined && root !== undefined) {
    refuse(
      "domicile: DOMICILE_MODULE and DOMICILE_ROOT both name a shell, and they" +
        " are not the same instruction. Pass one.",
    );
  }

  if (modulePath === undefined) {
    return {
      root:
        root ??
        refuse("domicile: one of DOMICILE_MODULE or DOMICILE_ROOT is required"),
    };
  }

  // Checked before serving rather than 404ing later. A module that is not
  // there produces a document naming a script the browser cannot fetch, which
  // is a desktop that comes up blank with nothing in this process's own log —
  // and the path is the one thing that would have said why.
  if (!(await exists(modulePath))) {
    return refuse(`domicile: there is no module at ${modulePath}`);
  }
  const resolved = path.resolve(modulePath);
  return { module: path.basename(resolved), root: path.dirname(resolved) };
};
