// Window states a shell sets and the requests clients make for them, as
// `System.setWindowStates` and `System.windowRequests` carry them. See
// docs/WRITING-A-SHELL.md.

/**
 * An `xdg_toplevel` state the shell sets on a window. Tiled states tell a
 * client its edges touch something, so it draws no shadow, rounded corners or
 * resize border there. A client too old for tiled states is sent `Maximized`
 * instead.
 */
export enum WindowState {
  TiledLeft,
  TiledRight,
  TiledTop,
  TiledBottom,
  Maximized,
  Fullscreen,
}

export enum WindowRequestKind {
  Maximize,
  Unmaximize,
  Fullscreen,
  Unfullscreen,
}

/**
 * What a client asked of window `appId`. The compositor grants nothing; the
 * shell does with `setWindowStates`.
 */
export const WindowRequest = {
  /** `display` names the display the client wants, if it named one. */
  Fullscreen: (appId: string, display: string | undefined) => ({
    appId,
    display,
    kind: WindowRequestKind.Fullscreen as const,
  }),
  Maximize: (appId: string) => ({
    appId,
    kind: WindowRequestKind.Maximize as const,
  }),
  Unfullscreen: (appId: string) => ({
    appId,
    kind: WindowRequestKind.Unfullscreen as const,
  }),
  Unmaximize: (appId: string) => ({
    appId,
    kind: WindowRequestKind.Unmaximize as const,
  }),
};

export type WindowRequest = ReturnType<
  (typeof WindowRequest)[keyof typeof WindowRequest]
>;

/** A state as the compositor names it. */
export const wireWindowState = (state: WindowState): string => {
  switch (state) {
    case WindowState.TiledLeft:
      return "tiled_left";
    case WindowState.TiledRight:
      return "tiled_right";
    case WindowState.TiledTop:
      return "tiled_top";
    case WindowState.TiledBottom:
      return "tiled_bottom";
    case WindowState.Maximized:
      return "maximized";
    case WindowState.Fullscreen:
      return "fullscreen";
  }
};
