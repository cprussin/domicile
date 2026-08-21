/** The switch the main process passes the renderer the socket path on. */
const SWITCH = "--domicile-chrome-socket=";

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
