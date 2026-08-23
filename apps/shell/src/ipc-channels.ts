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
// What is left is the things a renderer cannot do for itself.

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

/**
 * Chrome → host: claim a key combination from the pages this window embeds.
 *
 * A `<webview>` is a browsing context of its own, so a key pressed in one is
 * given to it and to nothing else — the shell's page hears nothing, which is
 * exactly when the user reaches for the combination that opens another window.
 * The main process is the only thing above a guest that sees the key first.
 * See `guest-shortcuts`.
 */
export const CHROME_GRAB_SHORTCUT_CHANNEL = "domicile:grab-shortcut";

/**
 * Host → chrome: a claimed combination was pressed in an embedded page.
 *
 * The guest is not given it, so this is the only account of the keystroke the
 * page gets — the same bargain the compositor's `grab_shortcut` strikes with a
 * Wayland client.
 */
export const CHROME_SHORTCUT_CHANNEL = "domicile:shortcut";

/**
 * Chrome → host: make the window this size, in logical pixels.
 *
 * The page is the desktop and the desktop is the compositor's, described to
 * the renderer over its own socket — but the window it is drawn in belongs to
 * the main process. A window smaller than the desktop leaves the right-hand
 * screens off the end of the viewport, still laying out and still reporting
 * positions the compositor honours, so the size has to cross back. See
 * `desktop-size`.
 */
export const CHROME_DESKTOP_SIZE_CHANNEL = "domicile:desktop-size";
