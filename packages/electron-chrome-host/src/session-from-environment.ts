// The session, as the chrome's own Electron process learns it.
//
// The launcher started the compositor and knows everything about it; this is
// the reading half, and it is what a shell's `main.ts` calls first.

import type { Environment } from "./chrome-invocation";
import type { CompositorSession } from "./compositor-session";
import { parseSession } from "./compositor-session";

/** Where the launcher leaves the session for the process it starts. */
const VARIABLE = "DOMICILE_SESSION";

/**
 * The compositor this chrome belongs to.
 *
 * Throws when it is absent, which means the chrome was started by something
 * other than its own launcher: it is half of a desktop, and the half it would
 * be missing is the one that knows where everything is.
 */
export const sessionFromEnvironment = (
  environment: Environment,
): CompositorSession => {
  const published = environment[VARIABLE];
  if (published === undefined) {
    throw new Error(
      `domicile: the chrome was started without ${VARIABLE}; run the shell rather than its Electron bundle`,
    );
  } else {
    return parseSession(published);
  }
};
