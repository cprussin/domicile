// A window the shell holds: either a Wayland client the host announced or a
// browser window the shell opened itself. Both are tiled, floated and closed
// the same way, so they share one id space and one title.

import type { CursorShape } from "@domicile/chrome-sdk/cursor-shape";

/** The prefix {@link appWindowId} namespaces a client's window with. */
const APP_PREFIX = "app:";

/**
 * Where a browser window opens.
 *
 * The window model's rather than either caller's, because both of them open
 * the same window: the bar's `+` and the key the sway config puts its
 * launcher on.
 */
export const HOME_PAGE = "https://www.google.com";

/** Which kind of window a {@link ShellWindow} is. */
export enum WindowKind {
  App,
  Browser,
}

/**
 * A Wayland client's window, as the shell holds it.
 *
 * Two kinds of fact on one record: the shell's own — a title — and the
 * cursor, which is the client's and arrives as a host message. The cursor is
 * here for the reason state is anywhere: the element for a window is unmounted
 * and mounted again whenever the shell stops rendering it and starts again, and
 * the style it is given on the way back has to be current.
 *
 * The size the client drew at used to be here too, and is not: the SDK records
 * it as the message goes past, because scaling the pointer by it is the only
 * thing anyone does with it. This shell was a courier.
 *
 * Written out rather than left to the constructor's inferred shape because a
 * field the client has not reported yet still has a type — a client that has
 * asked for no cursor is `undefined`, not absent.
 */
export type ClientWindow = {
  appId: string;
  /** The cursor the client asked for, or `undefined` while it has asked for none. */
  cursor: CursorShape | undefined;
  id: string;
  kind: WindowKind.App;
  title: string;
};

export const ShellWindow = {
  /**
   * A Wayland client's window. `appId` is the host's name for the client and
   * `id` namespaces it, so a client can never collide with a browser window.
   */
  App: (appId: string, title: string): ClientWindow => ({
    appId,
    cursor: undefined,
    id: appWindowId(appId),
    kind: WindowKind.App,
    title,
  }),

  /**
   * A browser window the shell opened. `src` is the address it starts at and
   * never changes afterward — the embedded view owns navigation from there,
   * and rewriting `src` would reload the page out from under it.
   */
  Browser: (ordinal: number, src: string) => ({
    id: `browser:${ordinal.toString()}`,
    kind: WindowKind.Browser as const,
    src,
    title: siteOf(src),
  }),
};

export type ShellWindow = ReturnType<
  (typeof ShellWindow)[keyof typeof ShellWindow]
>;

/**
 * The window id for a client the host announced. Separate from the constructor
 * so a lookup by app id doesn't have to build a whole window to get at it.
 */
export const appWindowId = (appId: string): string => `${APP_PREFIX}${appId}`;

/**
 * The client behind a window id, or `undefined` when the shell opened the
 * window itself.
 *
 * The inverse of {@link appWindowId}, and here for the same reason: what the
 * chrome reports is an id, and what the host answers to is an app id.
 */
export const appIdOf = (id: string): string | undefined =>
  id.startsWith(APP_PREFIX) ? id.slice(APP_PREFIX.length) : undefined;

/** A window is named after the site it is showing, the way a browser tab is. */
export const siteOf = (url: string): string => new URL(url).hostname;
