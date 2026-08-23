/**
 * Chrome → terminal: one line of diagnostics.
 *
 * The renderer has no stdout, and its console goes to devtools that nobody has
 * open while driving the prototype from a terminal. This chrome's half of the
 * frame timing is useless where it cannot be read next to the compositor's, so
 * it asks the main process to print it. See `diagnostic-lines`.
 *
 * This chrome's own, not `@domicile/electron-chrome-host`'s: a shell that
 * reports no timings — the simple one — never opens this channel, and the
 * package holds only what every chrome needs.
 */
export const CHROME_DIAGNOSTIC_CHANNEL = "domicile:diagnostic";
