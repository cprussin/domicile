// A window the shell holds: a Wayland client the host announced or a browser
// window the engine listed. The shell tiles and floats both, but the client or
// the engine opens and closes them. They share one id space and one title.

import type { CursorShape } from "@domicile-desktop/sdk/cursor-shape";

/** The prefix {@link appWindowId} namespaces a client's window with. */
const APP_PREFIX = "app:";

/** The prefix {@link browserWindowId} namespaces a browser window with. */
const BROWSER_PREFIX = "browser:";

/** The name of a browser window with no address yet. */
const BLANK_PAGE = "about:blank";

/**
 * Where a new browser window opens, from the bar's `+` or the sway launcher
 * key.
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
 * The cursor is stored here because a window's element can unmount and
 * remount, and must get the current cursor back when it does.
 */
export type ClientWindow = {
  appId: string;
  /** The cursor the client asked for, or `undefined` if none. */
  cursor: CursorShape | undefined;
  id: string;
  kind: WindowKind.App;
  /** The largest the client will draw its window. */
  maxSize: SizeLimit;
  /** The smallest the client will draw its window. */
  minSize: SizeLimit;
  title: string;
};

/**
 * A client's size limit per axis, in layout pixels. `undefined` means no
 * limit.
 */
export type SizeLimit = readonly [
  width: number | undefined,
  height: number | undefined,
];

/** No limit on either axis; the initial value for every window. */
export const UNLIMITED: SizeLimit = [undefined, undefined];

export const ShellWindow = {
  /**
   * A Wayland client's window. `id` is namespaced so it cannot collide with a
   * browser window's.
   */
  App: (appId: string, title: string): ClientWindow => ({
    appId,
    cursor: undefined,
    id: appWindowId(appId),
    kind: WindowKind.App,
    maxSize: UNLIMITED,
    minSize: UNLIMITED,
    title,
  }),

  /**
   * A browser window from the engine's list.
   *
   * - `windowId`: the engine's id, for `<webview window>`. `id` prefixes it.
   * - `url`: the page's current address.
   * - `popupWindow`: the `chrome.windows` id of the extension popup window
   *   whose one tab this is. Drawn without an address bar, as in Chrome.
   */
  Browser: (
    windowId: string,
    url: string,
    popupWindow: number | undefined,
  ) => ({
    id: browserWindowId(windowId),
    kind: WindowKind.Browser as const,
    popupWindow,
    title: url === "" ? BLANK_PAGE : siteOf(url),
    url,
  }),
};

export type ShellWindow = ReturnType<
  (typeof ShellWindow)[keyof typeof ShellWindow]
>;

/**
 * The window id for a host client, usable without building a window.
 */
export const appWindowId = (appId: string): string => `${APP_PREFIX}${appId}`;

/**
 * The inverse of {@link appWindowId}: the client's app id, or `undefined` for
 * a window the shell opened itself.
 */
export const appIdOf = (id: string): string | undefined =>
  id.startsWith(APP_PREFIX) ? id.slice(APP_PREFIX.length) : undefined;

/** Returns the window id for a browser window the engine listed. */
export const browserWindowId = (windowId: string): string =>
  `${BROWSER_PREFIX}${windowId}`;

/**
 * Returns the engine's browser window id behind a window id, or `undefined`
 * for a client's window. Closing a window asks the engine to close this id.
 */
export const browserIdOf = (id: string): string | undefined =>
  id.startsWith(BROWSER_PREFIX) ? id.slice(BROWSER_PREFIX.length) : undefined;

/**
 * A window's title: the host of the URL it shows, or the whole URL when it has
 * no host (such as `about:blank` or `data:` URLs a page navigates to).
 */
export const siteOf = (url: string): string => {
  const { hostname } = new URL(url);
  return hostname === "" ? url : hostname;
};
