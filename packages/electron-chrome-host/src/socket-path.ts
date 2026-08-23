// Where the compositor's chrome socket is, from both sides of the Electron
// host: the main process resolves it from the environment, and the preload
// reads it back off the command line the main process started it with.

import path from "node:path";

/** The switch the main process passes the renderer the socket path on. */
const SWITCH = "--domicile-chrome-socket=";

/** What the socket is called when nothing named it. */
const SOCKET_NAME = "domicile-chrome.sock";

/**
 * The environment as the main process has it.
 *
 * An index signature rather than the two names below, because that is the shape
 * `process.env` has: a type of nothing but optional properties is a weak one,
 * which TypeScript refuses an object that shares no key with it — which
 * `ProcessEnv`, being an index signature, technically does not.
 */
export type ChromeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The compositor socket the main process should connect the chrome to.
 *
 * `XDG_RUNTIME_DIR` must stay short: a Unix socket path is capped near 108
 * bytes (SUN_LEN), which a deep scratch directory blows past. Neither variable
 * being set is not a failure — it is a chrome started from the directory the
 * compositor is running in, which is how the prototype scripts do it.
 */
export const chromeSocketPath = ({
  DOMICILE_CHROME_SOCKET,
  XDG_RUNTIME_DIR,
}: ChromeEnvironment): string =>
  DOMICILE_CHROME_SOCKET ?? path.join(XDG_RUNTIME_DIR ?? ".", SOCKET_NAME);

/**
 * The compositor socket the main process picked, out of the renderer's argv.
 *
 * Electron appends `webPreferences.additionalArguments` to the renderer's
 * command line, which is the one channel a preload can read *before* it has
 * anything else to read: the socket has to be open before the page's first
 * message, so there is no round trip to the main process to ask.
 *
 * Its own module so it can be tested without Electron.
 */
export const socketPathFrom = (argv: readonly string[]): string => {
  const passed = argv.find((argument) => argument.startsWith(SWITCH));
  if (passed === undefined) {
    // Not a condition to recover from: the main process always passes it, so
    // its absence means the two halves were built apart. Returning `""` would
    // connect to nothing and wait forever, which reads as a compositor that
    // never answered. The preload catches this and dies saying so.
    throw new Error(`shell: the renderer was started without ${SWITCH}`);
  } else {
    return passed.slice(SWITCH.length);
  }
};
