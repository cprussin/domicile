// The Electron IPC channel names the main process and the preload agree on.
// They live in their own module because the preload is bundled separately from
// the main process, so a shared literal is the only thing keeping them in sync.
//
// Both directions of the host protocol are *absent* from this list on purpose.
// The preload holds the compositor socket itself, so a frame's pixels never
// cross a process boundary: they are read in the renderer and handed to the
// page. Sending them through here cost 79ms a frame, against ~8ms for the GPU
// readback that produced them.
//
// What is left is the two things a renderer cannot do for itself.

/**
 * Chrome → terminal: one line of diagnostics.
 *
 * The renderer has no stdout, and its console goes to devtools that nobody has
 * open while driving the prototype from a terminal. The chrome's half of the
 * frame timing is useless where it cannot be read next to the compositor's, so
 * it asks the main process to print it.
 */
export const CHROME_DIAGNOSTIC_CHANNEL = "domicile:diagnostic";

/**
 * Chrome → terminal, and then out: a line for stderr and an exit code.
 *
 * One channel rather than two because dying with a reason is one action, and a
 * page cannot do either half of it: `app.exit` is the main process's, and so is
 * the file descriptor the reason goes to.
 */
export const CHROME_FAILURE_CHANNEL = "domicile:failure";
