// A window the shell holds: either a Wayland client the host announced or a
// browser window the shell opened itself. Both are tiled, floated and closed
// the same way, so they share one id space and one title.

import type { CursorShape } from "@domicile-desktop/sdk/cursor-shape";

/** The prefix {@link appWindowId} namespaces a client's window with. */
const APP_PREFIX = "app:";

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
 * A window an extension requested with `chrome.windows.create` (see
 * `WEBVIEW_POPUP_WINDOW_EVENT`). A size of 0 means the axis was unspecified.
 */
export type PopupWindowRequest = {
  height: number;
  url: string;
  width: number;
  windowId: number;
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
   * A browser window the shell opened. `src` is the start address and never
   * changes: the view owns navigation, and changing `src` would reload it.
   */
  Browser: (ordinal: number, src: string) => ({
    id: `browser:${ordinal.toString()}`,
    kind: WindowKind.Browser as const,
    popupWindow: undefined,
    src,
    title: siteOf(src),
  }),

  /**
   * A browser window opened by an extension (see {@link PopupWindowRequest}).
   * `popupWindow` is its `chrome.windows` id, passed to the view on creation.
   */
  PopupWindow: (ordinal: number, { url, windowId }: PopupWindowRequest) => ({
    id: `browser:${ordinal.toString()}`,
    kind: WindowKind.Browser as const,
    popupWindow: windowId,
    src: url,
    title: siteOf(url),
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

/**
 * A window's title: the host of the URL it shows, or the whole URL when it has
 * no host (such as `about:blank` or `data:` URLs a page navigates to).
 */
export const siteOf = (url: string): string => {
  const { hostname } = new URL(url);
  return hostname === "" ? url : hostname;
};
