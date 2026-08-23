/**
 * Chrome → host: make the window this size, in logical pixels.
 *
 * The page is the desktop and the desktop is the compositor's, described to the
 * renderer over its own socket — but the window it is drawn in belongs to the
 * main process. A window smaller than the desktop leaves the right-hand screens
 * off the end of the viewport, still laying out and still reporting positions
 * the compositor honours, so the size has to cross back. See `desktop-size`.
 *
 * This chrome's own, not `@domicile/electron-chrome-host`'s: a shell that lays
 * nothing out against the displays never asks. The package holds only what
 * every chrome needs.
 */
export const CHROME_DESKTOP_SIZE_CHANNEL = "domicile:desktop-size";
