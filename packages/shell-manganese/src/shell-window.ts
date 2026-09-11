// A window on the stage: either a Wayland client the host announced or a
// browser window the shell opened itself. Both get a tab, and the tab rail is
// what switches between them, so they share one id space and one title.

import type { SurfaceSize } from "@domicile/chrome-sdk/app-element";
import type { CursorShape } from "@domicile/chrome-sdk/cursor-shape";

/** The prefix {@link appWindowId} namespaces a client's window with. */
const APP_PREFIX = "app:";

/** Which kind of window a {@link ShellWindow} is. */
export enum WindowKind {
  App,
  Browser,
}

/**
 * A Wayland client's window, as the shell holds it.
 *
 * Two kinds of fact on one record: the shell's own — a tab, a title — and the
 * client's, which arrive as host messages and are rendered onto the portal.
 * The client's are what a side registry of live elements used to hold, and they
 * are here for the reason state is anywhere: the portal for a window is
 * unmounted and mounted again whenever the shell stops rendering it and starts
 * again, and what it is told on the way back has to be current.
 *
 * Written out rather than left to the constructor's inferred shape because a
 * field the client has not reported yet still has a type — a window that has
 * not drawn is `undefined`, not absent.
 */
export type ClientWindow = {
  appId: string;
  /** The cursor the client asked for, or `undefined` while it has asked for none. */
  cursor: CursorShape | undefined;
  id: string;
  kind: WindowKind.App;
  /**
   * The size the client is last known to have drawn at, or `undefined` for one
   * that has not: a toplevel maps before it draws, and how big a Wayland client
   * wants to be is something it says by drawing.
   */
  surfaceSize: SurfaceSize | undefined;
  title: string;
};

export const ShellWindow = {
  /**
   * A Wayland client's portal. `appId` is the host's name for the client and
   * `id` namespaces it, so a client can never collide with a browser window.
   */
  App: (appId: string, title: string): ClientWindow => ({
    appId,
    cursor: undefined,
    id: appWindowId(appId),
    kind: WindowKind.App,
    surfaceSize: undefined,
    title,
  }),

  /**
   * A browser window the shell opened. `src` is the address it starts at and
   * never changes afterwards — the embedded view owns navigation from there,
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
 * tab rail reports is an id, and what the host answers to is an app id.
 */
export const appIdOf = (id: string): string | undefined =>
  id.startsWith(APP_PREFIX) ? id.slice(APP_PREFIX.length) : undefined;

/** A window is labelled by the site it is showing, the way a browser tab is. */
export const siteOf = (url: string): string => new URL(url).hostname;
