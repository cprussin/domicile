// A window on the stage: either a Wayland client the host announced or a
// browser window the shell opened itself. Both get a tab, and the tab rail is
// what switches between them, so they share one id space and one title.

/** The prefix {@link appWindowId} namespaces a client's window with. */
const APP_PREFIX = "app:";

/** Which kind of window a {@link ShellWindow} is. */
export enum WindowKind {
  App,
  Browser,
}

export const ShellWindow = {
  /**
   * A Wayland client's portal. `appId` is the host's name for the client and
   * `id` namespaces it, so a client can never collide with a browser window.
   */
  App: (appId: string, title: string) => ({
    appId,
    id: appWindowId(appId),
    kind: WindowKind.App as const,
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
