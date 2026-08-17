// The Electron IPC channel names the main process and the preload agree on.
// They live in their own module because the preload is bundled separately from
// the main process, so a shared literal is the only thing keeping them in sync.

/** Host → chrome: one whole JSON frame from the compositor. */
export const HOST_TO_CHROME_CHANNEL = "domicile:message";

/** Chrome → host: one whole JSON frame for the compositor. */
export const CHROME_TO_HOST_CHANNEL = "domicile:send";

/**
 * Chrome → terminal: one line of diagnostics.
 *
 * The renderer has no stdout, and its console goes to devtools that nobody has
 * open while driving the prototype from a terminal. The chrome's half of the
 * frame timing is useless where it cannot be read next to the compositor's, so
 * it asks the main process to print it.
 */
export const CHROME_DIAGNOSTIC_CHANNEL = "domicile:diagnostic";
