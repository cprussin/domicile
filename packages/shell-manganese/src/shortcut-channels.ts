// The Electron IPC channel names main and preload agree on for the one thing
// this chrome needs of its host beyond the compositor socket and a terminal to
// print to: the keys an embedded page would otherwise swallow.
//
// This chrome's own, next to `guest-shortcuts`, rather than in
// `@domicile/electron-chrome-host`: a shell with no `<webview>` in it has
// nothing to claim keys from.

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
