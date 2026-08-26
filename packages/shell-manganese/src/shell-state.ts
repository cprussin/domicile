// Every change the shell's window list can undergo, as one pure reduction.
//
// The shell owns two things: which windows exist and which one has the stage.
// Both move together — a window that opens takes the stage, a window that
// closes hands it back — so they are one state, reduced in one place, with no
// DOM or bridge in sight. `useShellWindows` is what feeds host events into it.

import type { DropPosition } from "@domicile/component-library/TabRail";

import type { ShellWindow } from "./shell-window";
import { appWindowId, ShellWindow as Window } from "./shell-window";

export type ShellState = {
  /** How many browser windows have been opened, ever — the id counter. */
  browsersOpened: number;
  /**
   * The app that holds the keyboard, or `undefined` when the chrome does.
   *
   * Not the same as `shownId`: the stage says which window the shell is
   * *showing*, and this says which one the compositor is *typing into*. They
   * agree while the shell is the only thing moving focus, and part company the
   * moment a click does — which is what this exists to follow.
   */
  focusedId: string | undefined;
  /** The window on the stage, or `undefined` when nothing is open. */
  shownId: string | undefined;
  windows: readonly ShellWindow[];
};

/** A shell with nothing open: what the chrome starts from. */
export const EMPTY_SHELL: ShellState = {
  browsersOpened: 0,
  focusedId: undefined,
  shownId: undefined,
  windows: [],
};

export enum ShellActionKind {
  AppAppeared,
  AppClosed,
  AppTitled,
  BrowserOpened,
  FocusChanged,
  WindowClosed,
  WindowRenamed,
  WindowSelected,
  WindowsReordered,
}

export const ShellAction = {
  /** The host announced a Wayland client. */
  AppAppeared: (appId: string, title: string | undefined) => ({
    appId,
    kind: ShellActionKind.AppAppeared as const,
    title,
  }),

  /** The host says the client is gone. */
  AppClosed: (appId: string) => ({
    appId,
    kind: ShellActionKind.AppClosed as const,
  }),

  /**
   * The client said what its window is called, or unset it.
   *
   * Separate from {@link ShellAction.AppAppeared} because a toplevel is
   * announced when the client creates it, which is before `set_title` — and
   * because it happens again whenever the name changes, which for a terminal
   * is every command it runs.
   */
  AppTitled: (appId: string, title: string | undefined) => ({
    appId,
    kind: ShellActionKind.AppTitled as const,
    title,
  }),

  /** The user asked for a browser window, pointed at `src`. */
  BrowserOpened: (src: string) => ({
    kind: ShellActionKind.BrowserOpened as const,
    src,
  }),

  /**
   * The compositor moved the keyboard, by whatever route.
   *
   * `undefined` means the chrome holds it. This arrives for focus the shell
   * asked for *and* for focus it did not — a click on a window, or a focused
   * client going away — which is the whole reason it is a message.
   */
  FocusChanged: (appId: string | undefined) => ({
    appId,
    kind: ShellActionKind.FocusChanged as const,
  }),

  /** The user closed a window from its tab. */
  WindowClosed: (id: string) => ({
    id,
    kind: ShellActionKind.WindowClosed as const,
  }),

  /** A browser window's page navigated, so its tab says somewhere new. */
  WindowRenamed: (id: string, title: string) => ({
    id,
    kind: ShellActionKind.WindowRenamed as const,
    title,
  }),

  /** The user picked a window's tab. */
  WindowSelected: (id: string) => ({
    id,
    kind: ShellActionKind.WindowSelected as const,
  }),

  /** The user dragged (or keyed) `fromId` to sit beside `toId`. */
  WindowsReordered: (fromId: string, toId: string, position: DropPosition) => ({
    fromId,
    kind: ShellActionKind.WindowsReordered as const,
    position,
    toId,
  }),
};

export type ShellAction = ReturnType<
  (typeof ShellAction)[keyof typeof ShellAction]
>;

export const reduceShell = (
  state: ShellState,
  action: ShellAction,
): ShellState => {
  switch (action.kind) {
    case ShellActionKind.AppAppeared: {
      return openApp(state, action.appId, action.title);
    }
    case ShellActionKind.AppClosed: {
      return closeWindow(state, appWindowId(action.appId));
    }
    case ShellActionKind.AppTitled: {
      // The same fallback the window opened with. A client that named its
      // window nothing — `set_title("")`, which the SDK reads as no name —
      // gets the app id, exactly as one that has not named it yet does.
      return renameWindow(
        state,
        appWindowId(action.appId),
        action.title ?? action.appId,
      );
    }
    case ShellActionKind.BrowserOpened: {
      return openBrowser(state, action.src);
    }
    case ShellActionKind.FocusChanged: {
      const focusedId =
        action.appId === undefined ? undefined : appWindowId(action.appId);
      // The same object when it did not move, so React bails out rather than
      // re-rendering every window. The host only sends this on a change, but
      // a chrome that has just connected is told the current holder too, and
      // that one usually says what the shell already knew.
      return focusedId === state.focusedId ? state : { ...state, focusedId };
    }
    case ShellActionKind.WindowClosed: {
      return closeWindow(state, action.id);
    }
    case ShellActionKind.WindowRenamed: {
      return renameWindow(state, action.id, action.title);
    }
    case ShellActionKind.WindowSelected: {
      return showWindow(state, action.id);
    }
    case ShellActionKind.WindowsReordered: {
      return {
        ...state,
        windows: moveWindow(
          state.windows,
          action.fromId,
          action.toId,
          action.position,
        ),
      };
    }
  }
};

// A client the shell already has a window for is the host re-announcing it,
// not a second window: the portal is keyed by app id.
const openApp = (
  state: ShellState,
  appId: string,
  title: string | undefined,
): ShellState => {
  const window = Window.App(appId, title ?? appId);
  return state.windows.some((open) => open.id === window.id)
    ? state
    : openWindow(state, window);
};

const openBrowser = (state: ShellState, src: string): ShellState => {
  const browsersOpened = state.browsersOpened + 1;
  return openWindow(
    { ...state, browsersOpened },
    Window.Browser(browsersOpened, src),
  );
};

// A window that opens takes the stage; whatever had it is a tab away.
const openWindow = (state: ShellState, window: ShellWindow): ShellState => ({
  ...state,
  shownId: window.id,
  windows: [...state.windows, window],
});

// The stage goes to the most recently opened of the survivors, so closing a
// window lands on the one the user was on before it. A close for a window the
// shell never opened is the host draining events for a portal already torn
// down, which leaves the list as it is.
const closeWindow = (state: ShellState, id: string): ShellState => {
  const windows = state.windows.filter((window) => window.id !== id);
  return {
    ...state,
    shownId: state.shownId === id ? windows.at(-1)?.id : state.shownId,
    windows,
  };
};

const renameWindow = (
  state: ShellState,
  id: string,
  title: string,
): ShellState => ({
  ...state,
  windows: state.windows.map((window) =>
    window.id === id ? { ...window, title } : window,
  ),
});

const showWindow = (state: ShellState, id: string): ShellState => {
  if (state.windows.some((window) => window.id === id)) {
    return { ...state, shownId: id };
  } else {
    throw new Error(`shell: no window ${id} to show`);
  }
};

const moveWindow = (
  windows: readonly ShellWindow[],
  fromId: string,
  toId: string,
  position: DropPosition,
): readonly ShellWindow[] => {
  const moved = windows.find((window) => window.id === fromId);
  if (moved === undefined) {
    throw new Error(`shell: no window ${fromId} to move`);
  } else {
    const rest = windows.filter((window) => window.id !== fromId);
    const target = rest.findIndex((window) => window.id === toId);
    if (target === -1) {
      throw new Error(`shell: no window ${toId} to drop onto`);
    } else {
      const at = position === "before" ? target : target + 1;
      return [...rest.slice(0, at), moved, ...rest.slice(at)];
    }
  }
};
