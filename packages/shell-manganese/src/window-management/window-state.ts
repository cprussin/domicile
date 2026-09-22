// Every change the desktop can undergo, as one pure reduction.
//
// The shell owns three things: which windows exist, which workspace each of
// them is on, and which key bindings are live. They move together — a window
// that opens lands on the workspace being looked at, a window sent to the
// scratchpad leaves every workspace — so they are one state, reduced in one
// place, with no DOM or domicile client in sight. `useWindows` is what feeds
// host events and keystrokes into it.
//
// **The actions are sway's commands.** `keyboard/bindings.ts` is a table from
// a key to one of the constructors below, so the desktop's vocabulary is the
// one the user's config is written in: `focus left`, `move container to
// workspace 2`, `layout tabbed`. What a command *means* is the workspace's or
// the tree's to say, and almost every arm of the reduction is one call into
// `workspace.ts`.

import type { CursorShape } from "@domicile/chrome-sdk/cursor-shape";

import type { Axis, Direction } from "./direction";
import type { Layout } from "./tree/node";
import type { ClientWindow, ShellWindow } from "./window";
import { appWindowId, ShellWindow as Window, WindowKind } from "./window";
import type { Workspace } from "./workspace";
import {
  childFocused,
  closed,
  containerLaidOut,
  containerSplit,
  emptyWorkspace,
  floatMoved,
  floatOn,
  floatSized,
  floatToggled,
  focusedOn,
  focusStepped,
  fullscreenToggled,
  holds,
  modeToggled,
  opened,
  parentFocused,
  pointedAt,
  reached,
  shown,
  splitFlipped,
  windowGrown,
  windowMoved,
} from "./workspace";

/**
 * Which set of bindings the keys are read in.
 *
 * sway's binding modes, of which this desktop has the two its config names:
 * the default one, and the resize mode `mod+r` enters.
 */
export enum BindingMode {
  Default,
  Resize,
}

/**
 * The workspaces, by the names the config's keys name them with.
 *
 * All ten exist from the start rather than being made as they are reached.
 * sway creates and destroys them on demand, which is a difference the user can
 * see in exactly one place — the bar — and the bar shows the ones that have
 * something on them, so the two agree where it counts.
 */
export const WORKSPACES: readonly string[] = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
];

export type WindowState = {
  /** How many browser windows have been opened, ever — the id counter. */
  browsersOpened: number;
  /** The workspace on screen. */
  current: string;
  /**
   * The floating window the user has hold of, or `undefined` when none is.
   *
   * Here rather than in the component that reads the pointer because it is
   * what makes the window see-through while it moves, and because a drag
   * outlives the modifier that started it: letting go of the modifier half
   * way through one must not drop the window.
   */
  draggingId: string | undefined;
  /**
   * The app that holds the keyboard, or `undefined` when the chrome does.
   *
   * Not the same as the window being worked in: that is the shell's own idea
   * and this is the compositor's. They agree while the shell is the only
   * thing moving focus, and part company the moment a click does — which is
   * what this exists to follow.
   */
  focusedId: string | undefined;
  /**
   * Whether the launcher's panel is up.
   *
   * Here rather than in the component that draws it because it is a desktop
   * state and not a widget's: the key that opens it is a line in the same
   * bindings table as every other key, and what closes it is usually
   * something else being launched. A panel that owned its own `useState`
   * would need the bindings to reach into it and every launch to remember to
   * close it.
   */
  launcherOpen: boolean;
  /**
   * Whether the clipboard's history is up.
   *
   * Desktop state for {@link WindowState.launcherOpen}'s reason: the key that
   * opens it is a line in the same bindings table as every other key, and a
   * panel that owned its own `useState` would need the bindings to reach into
   * it.
   */
  clipboardOpen: boolean;
  mode: BindingMode;
  /**
   * The workspace the current one was reached from, which the same key goes
   * back to (`workspaceAutoBackAndForth`).
   */
  previous: string | undefined;
  /** The windows in the scratchpad, the most recently hidden last. */
  scratchpad: readonly string[];
  windows: readonly ShellWindow[];
  workspaces: readonly Workspace[];
};

/** A desktop with nothing open: what the chrome starts from. */
export const NO_WINDOWS: WindowState = {
  browsersOpened: 0,
  clipboardOpen: false,
  current: "1",
  draggingId: undefined,
  focusedId: undefined,
  launcherOpen: false,
  mode: BindingMode.Default,
  previous: undefined,
  scratchpad: [],
  windows: [],
  workspaces: WORKSPACES.map((name) => emptyWorkspace(name)),
};

/** The workspace on screen. */
export const workspaceOn = (state: WindowState): Workspace =>
  workspaceNamed(state, state.current);

/** The workspace of this name. Throws for a name the desktop does not have. */
export const workspaceNamed = (state: WindowState, name: string): Workspace => {
  const workspace = state.workspaces.find((found) => found.name === name);
  if (workspace === undefined) {
    throw new Error(`shell: no workspace ${name}`);
  } else {
    return workspace;
  }
};

/** The workspace the window `id` is on, or `undefined` for a hidden one. */
export const workspaceHolding = (
  state: WindowState,
  id: string,
): Workspace | undefined =>
  state.workspaces.find((workspace) => holds(workspace, id));

/** The window the user is working in, or `undefined` on an empty workspace. */
export const activeIdOf = (state: WindowState): string | undefined =>
  focusedOn(workspaceOn(state));

/** The window `id`, or `undefined` for one that has closed. */
export const windowOf = (
  state: WindowState,
  id: string,
): ShellWindow | undefined => state.windows.find((window) => window.id === id);

export enum WindowActionKind {
  AppAppeared,
  AppClosed,
  AppCursorChanged,
  AppTitled,
  BrowserOpened,
  ChildFocused,
  ClipboardDismissed,
  ClipboardToggled,
  ContainerSplit,
  EditorLaunched,
  FloatToggled,
  FocusChanged,
  FocusRequested,
  FocusStepped,
  FullscreenToggled,
  LauncherDismissed,
  LauncherToggled,
  LayoutSet,
  ModeSet,
  ModeSwapped,
  ParentFocused,
  ScratchpadShown,
  SplitToggled,
  TerminalLaunched,
  WindowClosed,
  WindowDropped,
  WindowFullscreened,
  WindowGrabbed,
  WindowGrown,
  WindowHovered,
  WindowKilled,
  WindowMoved,
  WindowRenamed,
  WindowResized,
  WindowSelected,
  WindowSentToScratchpad,
  WindowSentToWorkspace,
  WindowStepped,
  WorkspaceSelected,
}

export const WindowAction = {
  /** The host announced a Wayland client. */
  AppAppeared: (appId: string, title: string | undefined) => ({
    appId,
    kind: WindowActionKind.AppAppeared as const,
    title,
  }),

  /** The host says the client is gone. */
  AppClosed: (appId: string) => ({
    appId,
    kind: WindowActionKind.AppClosed as const,
  }),

  /** The client asked for a cursor to be shown over its window. */
  AppCursorChanged: (appId: string, cursor: CursorShape) => ({
    appId,
    cursor,
    kind: WindowActionKind.AppCursorChanged as const,
  }),

  /**
   * The client said what its window is called, or unset it.
   *
   * Separate from {@link WindowAction.AppAppeared} because a toplevel is
   * announced when the client creates it, which is before `set_title` — and
   * because it happens again whenever the name changes, which for a terminal
   * is every command it runs.
   */
  AppTitled: (appId: string, title: string | undefined) => ({
    appId,
    kind: WindowActionKind.AppTitled as const,
    title,
  }),

  /** The user asked for a browser window, pointed at `src`. */
  BrowserOpened: (src: string) => ({
    kind: WindowActionKind.BrowserOpened as const,
    src,
  }),

  /** `focus child`. */
  ChildFocused: () => ({ kind: WindowActionKind.ChildFocused as const }),

  /**
   * The clipboard's history was closed without anything being chosen —
   * Escape, a click on the backdrop, or the row that was chosen closing it.
   *
   * Separate from {@link WindowAction.ClipboardToggled} for
   * {@link WindowAction.LauncherDismissed}'s reason: it comes from the panel
   * rather than from a key, and a toggle here would re-open it on the way out.
   */
  ClipboardDismissed: () => ({
    kind: WindowActionKind.ClipboardDismissed as const,
  }),

  /**
   * `mod+shift+v`, which is the clipboard's key in both directions.
   *
   * One binding for the launcher's reason: the press that reaches the panel is
   * the press that gives up on it.
   */
  ClipboardToggled: () => ({
    kind: WindowActionKind.ClipboardToggled as const,
  }),

  /** `splith` / `splitv`. */
  ContainerSplit: (axis: Axis) => ({
    axis,
    kind: WindowActionKind.ContainerSplit as const,
  }),

  /**
   * The user picked a file in the launcher, which the compositor opens in
   * their editor.
   *
   * Nothing in the state moves but the panel: the editor is a Wayland client
   * and its window arrives as an announcement from the host, exactly as
   * {@link WindowAction.TerminalLaunched}'s does. `path` is relative to the
   * home directory, or absolute for a file outside it — see
   * `launcher/editor-command.ts`, which resolves the difference in the one
   * process that can.
   */
  EditorLaunched: (path: string) => ({
    kind: WindowActionKind.EditorLaunched as const,
    path,
  }),

  /** `floating toggle`. */
  FloatToggled: () => ({ kind: WindowActionKind.FloatToggled as const }),

  /**
   * The compositor moved the keyboard, by whatever route.
   *
   * `undefined` means the chrome holds it. This arrives for focus the shell
   * asked for *and* for focus it did not — a click on a window, or a focused
   * client going away — which is the whole reason it is a message.
   */
  FocusChanged: (appId: string | undefined) => ({
    appId,
    kind: WindowActionKind.FocusChanged as const,
  }),

  /**
   * A client asked for the keyboard. Nothing has moved yet.
   *
   * The compositor forwards the request over `xdg-activation` and leaves the
   * seat where it is, so what happens next is this shell's policy rather than
   * the desktop's. Manganese grants it, and goes to the workspace the window
   * is on to do it.
   */
  FocusRequested: (appId: string) => ({
    appId,
    kind: WindowActionKind.FocusRequested as const,
  }),

  /** `focus <direction>`. */
  FocusStepped: (direction: Direction) => ({
    direction,
    kind: WindowActionKind.FocusStepped as const,
  }),

  /** `fullscreen` — or `fullscreen toggle global`, across every screen. */
  FullscreenToggled: (global: boolean) => ({
    global,
    kind: WindowActionKind.FullscreenToggled as const,
  }),

  /**
   * The launcher was closed without launching anything — Escape, or a click
   * on the backdrop.
   *
   * Separate from {@link WindowAction.LauncherToggled} because it comes from
   * the dialog rather than from a key, and the dialog reports its own
   * closing: a toggle here would re-open the panel on the way out of it.
   */
  LauncherDismissed: () => ({
    kind: WindowActionKind.LauncherDismissed as const,
  }),

  /**
   * `mod+space`, which is the launcher's key in both directions.
   *
   * One binding rather than two, because the same press is what a person
   * reaches for to open the panel and to give up on it.
   */
  LauncherToggled: () => ({ kind: WindowActionKind.LauncherToggled as const }),

  /** `layout tabbed` / `layout stacking`. */
  LayoutSet: (layout: Layout) => ({
    kind: WindowActionKind.LayoutSet as const,
    layout,
  }),

  /** `mode resize` and the `mode default` that leaves it. */
  ModeSet: (mode: BindingMode) => ({
    kind: WindowActionKind.ModeSet as const,
    mode,
  }),

  /** `focus mode_toggle`: between the floating windows and the tiled ones. */
  ModeSwapped: () => ({ kind: WindowActionKind.ModeSwapped as const }),

  /** `focus parent`. */
  ParentFocused: () => ({ kind: WindowActionKind.ParentFocused as const }),

  /** `scratchpad show`. */
  ScratchpadShown: () => ({ kind: WindowActionKind.ScratchpadShown as const }),

  /** `layout toggle split`. */
  SplitToggled: () => ({ kind: WindowActionKind.SplitToggled as const }),

  /**
   * The user asked for a terminal, which the compositor spawns.
   *
   * Nothing in the state moves: the window arrives as an announcement from
   * the host like any other client's. It is an action so that the bindings
   * table can be one table of them.
   */
  TerminalLaunched: () => ({
    kind: WindowActionKind.TerminalLaunched as const,
  }),

  /** The user closed a window from its title bar. */
  WindowClosed: (id: string) => ({
    id,
    kind: WindowActionKind.WindowClosed as const,
  }),

  /** The user let go of the window they had hold of. */
  WindowDropped: () => ({ kind: WindowActionKind.WindowDropped as const }),

  /**
   * The user asked for a window to fill the screen, from the button on its
   * own title bar.
   *
   * `fullscreen` on a named window rather than on the one being worked in,
   * which is the difference between this and
   * {@link WindowAction.FullscreenToggled} — the same difference
   * {@link WindowAction.WindowClosed} has from `kill`. A bar belongs to one
   * window, so a button on it says which.
   *
   * Never global: `fullscreen toggle global` spreads a window across every
   * screen, and a button that did that on the press a user expected to
   * maximize would move the window to a monitor they were not looking at.
   * The chord is still there for it.
   */
  WindowFullscreened: (id: string) => ({
    id,
    kind: WindowActionKind.WindowFullscreened as const,
  }),

  /**
   * The user took hold of a floating window to move or resize it.
   *
   * Which of the two it will be is not recorded: the shell is told where the
   * window ends up, not what the pointer is doing, so a move and a resize are
   * the same drag as far as this is concerned.
   */
  WindowGrabbed: (id: string) => ({
    id,
    kind: WindowActionKind.WindowGrabbed as const,
  }),

  /** `resize grow` / `resize shrink`, which is what resize mode's keys do. */
  WindowGrown: (direction: Direction) => ({
    direction,
    kind: WindowActionKind.WindowGrown as const,
  }),

  /**
   * The pointer moved into a window, which is what makes it the window the
   * user is working in: focus follows the cursor here.
   *
   * Not the same as reaching for one, which is what a click is — see
   * {@link WindowAction.WindowSelected}.
   */
  WindowHovered: (id: string) => ({
    id,
    kind: WindowActionKind.WindowHovered as const,
  }),

  /** `kill`: close the window being worked in. */
  WindowKilled: () => ({ kind: WindowActionKind.WindowKilled as const }),

  /** The user dragged a floating window to a new corner of the desktop. */
  WindowMoved: (id: string, x: number, y: number) => ({
    id,
    kind: WindowActionKind.WindowMoved as const,
    x,
    y,
  }),

  /** A browser window's page navigated, so its title says somewhere new. */
  WindowRenamed: (id: string, title: string) => ({
    id,
    kind: WindowActionKind.WindowRenamed as const,
    title,
  }),

  /** The user dragged a floating window's corner to a new size. */
  WindowResized: (id: string, width: number, height: number) => ({
    height,
    id,
    kind: WindowActionKind.WindowResized as const,
    width,
  }),

  /** The user reached for a window — a click in it, or on its title bar. */
  WindowSelected: (id: string) => ({
    id,
    kind: WindowActionKind.WindowSelected as const,
  }),

  /** `move scratchpad`. */
  WindowSentToScratchpad: () => ({
    kind: WindowActionKind.WindowSentToScratchpad as const,
  }),

  /** `move container to workspace <name>`. */
  WindowSentToWorkspace: (name: string) => ({
    kind: WindowActionKind.WindowSentToWorkspace as const,
    name,
  }),

  /** `move <direction>`. */
  WindowStepped: (direction: Direction) => ({
    direction,
    kind: WindowActionKind.WindowStepped as const,
  }),

  /** `workspace <name>`. */
  WorkspaceSelected: (name: string) => ({
    kind: WindowActionKind.WorkspaceSelected as const,
    name,
  }),
};

export type WindowAction = ReturnType<
  (typeof WindowAction)[keyof typeof WindowAction]
>;

export const reduceWindows = (
  state: WindowState,
  action: WindowAction,
): WindowState => {
  switch (action.kind) {
    case WindowActionKind.AppAppeared: {
      return openApp(state, action.appId, action.title);
    }
    case WindowActionKind.AppClosed: {
      return closeWindow(state, appWindowId(action.appId));
    }
    case WindowActionKind.AppCursorChanged: {
      return reshapeApp(state, action.appId, (window) => ({
        ...window,
        cursor: action.cursor,
      }));
    }
    case WindowActionKind.AppTitled: {
      // The same fallback the window opened with. A client that named its
      // window nothing — `set_title("")`, which the SDK reads as no name —
      // gets the app id, exactly as one that has not named it yet does.
      return renameWindow(
        state,
        appWindowId(action.appId),
        action.title ?? action.appId,
      );
    }
    case WindowActionKind.BrowserOpened: {
      return openBrowser(state, action.src);
    }
    case WindowActionKind.ChildFocused: {
      return onCurrent(state, childFocused);
    }
    case WindowActionKind.ClipboardDismissed: {
      return { ...state, clipboardOpen: false };
    }
    case WindowActionKind.ClipboardToggled: {
      return { ...state, clipboardOpen: !state.clipboardOpen };
    }
    case WindowActionKind.ContainerSplit: {
      return onCurrent(state, (workspace) =>
        containerSplit(workspace, action.axis),
      );
    }
    case WindowActionKind.EditorLaunched: {
      // The compositor spawns it and the host announces the window it opens,
      // the same way a terminal's arrives. The panel goes, because the panel
      // is how the file was asked for.
      return { ...state, launcherOpen: false };
    }
    case WindowActionKind.FloatToggled: {
      return onCurrent(state, floatToggled);
    }
    case WindowActionKind.FocusChanged: {
      const focusedId =
        action.appId === undefined ? undefined : appWindowId(action.appId);
      // The same object when it did not move, so React bails out rather than
      // re-rendering every window. The host only sends this on a change, but
      // a chrome that has just connected is told the current holder too, and
      // that one usually says what the shell already knew.
      return focusedId === state.focusedId
        ? state
        : followFocus({ ...state, focusedId }, focusedId);
    }
    case WindowActionKind.FocusRequested: {
      return reachWindow(state, appWindowId(action.appId));
    }
    case WindowActionKind.FocusStepped: {
      return onCurrent(state, (workspace) =>
        focusStepped(workspace, action.direction),
      );
    }
    case WindowActionKind.FullscreenToggled: {
      return onCurrent(state, (workspace) =>
        fullscreenToggled(workspace, action.global),
      );
    }
    case WindowActionKind.LauncherDismissed: {
      return { ...state, launcherOpen: false };
    }
    case WindowActionKind.LauncherToggled: {
      return { ...state, launcherOpen: !state.launcherOpen };
    }
    case WindowActionKind.LayoutSet: {
      return onCurrent(state, (workspace) =>
        containerLaidOut(workspace, action.layout),
      );
    }
    case WindowActionKind.ModeSet: {
      return { ...state, mode: action.mode };
    }
    case WindowActionKind.ModeSwapped: {
      return onCurrent(state, modeToggled);
    }
    case WindowActionKind.ParentFocused: {
      return onCurrent(state, parentFocused);
    }
    case WindowActionKind.ScratchpadShown: {
      return showScratchpad(state);
    }
    case WindowActionKind.SplitToggled: {
      return onCurrent(state, splitFlipped);
    }
    case WindowActionKind.TerminalLaunched: {
      // The compositor spawns it and the host announces the window it opens.
      return state;
    }
    case WindowActionKind.WindowClosed: {
      return killWindow(state, action.id);
    }
    case WindowActionKind.WindowDropped: {
      return { ...state, draggingId: undefined };
    }
    case WindowActionKind.WindowFullscreened: {
      // Reached first, because `fullscreenToggled` is `mod+f` — it acts on the
      // window the workspace has the focus in, and the window this names is
      // the one whose bar was pressed. Pressing a bar is reaching for its
      // window anyway, so the two are one press.
      return onWorkspaceWith(
        reachWindow(state, action.id),
        action.id,
        (workspace) => fullscreenToggled(workspace, false),
      );
    }
    case WindowActionKind.WindowGrabbed: {
      // Taking hold of a window brings it to the front, the same way clicking
      // one does — which is what a grab is.
      return { ...reachWindow(state, action.id), draggingId: action.id };
    }
    case WindowActionKind.WindowGrown: {
      return onCurrent(state, (workspace) =>
        windowGrown(workspace, action.direction),
      );
    }
    case WindowActionKind.WindowHovered: {
      return pointAtWindow(state, action.id);
    }
    case WindowActionKind.WindowKilled: {
      const id = activeIdOf(state);
      return id === undefined ? state : killWindow(state, id);
    }
    case WindowActionKind.WindowMoved: {
      return onWorkspaceWith(state, action.id, (workspace) =>
        floatMoved(workspace, action.id, action.x, action.y),
      );
    }
    case WindowActionKind.WindowRenamed: {
      return renameWindow(state, action.id, action.title);
    }
    case WindowActionKind.WindowResized: {
      return onWorkspaceWith(state, action.id, (workspace) =>
        floatSized(workspace, action.id, action.width, action.height),
      );
    }
    case WindowActionKind.WindowSelected: {
      return reachWindow(state, action.id);
    }
    case WindowActionKind.WindowSentToScratchpad: {
      return hideInScratchpad(state);
    }
    case WindowActionKind.WindowSentToWorkspace: {
      return sendToWorkspace(state, action.name);
    }
    case WindowActionKind.WindowStepped: {
      return onCurrent(state, (workspace) =>
        windowMoved(workspace, action.direction),
      );
    }
    case WindowActionKind.WorkspaceSelected: {
      return selectWorkspace(state, action.name);
    }
  }
};

// The workspace on screen, put through `into`. Most of the keyed commands are
// exactly this: they act on what the user is looking at.
const onCurrent = (
  state: WindowState,
  into: (workspace: Workspace) => Workspace,
): WindowState => onWorkspace(state, state.current, into);

const onWorkspace = (
  state: WindowState,
  name: string,
  into: (workspace: Workspace) => Workspace,
): WindowState => ({
  ...state,
  workspaces: state.workspaces.map((workspace) =>
    workspace.name === name ? into(workspace) : workspace,
  ),
});

// The workspace the window `id` is on, put through `into`. A window the
// desktop has no workspace for — one in the scratchpad, or one whose close has
// already been reduced — leaves the state as it is.
const onWorkspaceWith = (
  state: WindowState,
  id: string,
  into: (workspace: Workspace) => Workspace,
): WindowState => {
  const workspace = workspaceHolding(state, id);
  return workspace === undefined
    ? state
    : onWorkspace(state, workspace.name, into);
};

// A client the shell already has a window for is the host re-announcing it,
// not a second window: the portal is keyed by app id.
const openApp = (
  state: WindowState,
  appId: string,
  title: string | undefined,
): WindowState => {
  const window = Window.App(appId, title ?? appId);
  return windowOf(state, window.id) === undefined
    ? openWindow(state, window)
    : state;
};

// The launcher shuts here as well as on `EditorLaunched`, because those are
// the two answers it has and a panel left up over its own answer is one the
// user has to dismiss after every URL they type. Harmless on the bar's `+`,
// where it is already shut.
const openBrowser = (state: WindowState, src: string): WindowState => {
  const browsersOpened = state.browsersOpened + 1;
  return openWindow(
    { ...state, browsersOpened, launcherOpen: false },
    Window.Browser(browsersOpened, src),
  );
};

// A window that opens lands tiled on the workspace being looked at and takes
// the keyboard, which is what sway does with a client it has not been told
// anything else about.
const openWindow = (state: WindowState, window: ShellWindow): WindowState =>
  onCurrent({ ...state, windows: [...state.windows, window] }, (workspace) =>
    opened(workspace, window.id),
  );

/**
 * `kill` on one window: the shell's own go at once, and a client's is asked.
 *
 * A client's window is the client's to end — the compositor sends its toplevel
 * a close and an editor with unsaved work is entitled to stay — so nothing
 * moves here and the window leaves on the `app_closed` that follows. The ask
 * itself is `useWindows`'s, because the state cannot make it.
 */
const killWindow = (state: WindowState, id: string): WindowState => {
  const window = windowOf(state, id);
  return window?.kind === WindowKind.Browser ? closeWindow(state, id) : state;
};

// A window gone from everywhere it could be: the list, whichever workspace had
// it, and the scratchpad. A close for a window the shell never opened is the
// host draining events for a portal already torn down, which leaves the state
// as it is.
const closeWindow = (state: WindowState, id: string): WindowState => ({
  ...state,
  draggingId: state.draggingId === id ? undefined : state.draggingId,
  scratchpad: state.scratchpad.filter((hidden) => hidden !== id),
  windows: state.windows.filter((window) => window.id !== id),
  workspaces: state.workspaces.map((workspace) =>
    holds(workspace, id) ? closed(workspace, id) : workspace,
  ),
});

// The compositor moving the keyboard onto a window is the user working in it,
// so the shell follows — and goes to the workspace the window is on, because
// a seat pointed at a window nobody can see is a desktop typing into thin air.
//
// Focus that landed on the chrome, or on a window the shell has not been told
// about yet, leaves the window being worked in where it was: there is nothing
// better to point at, and `undefined` would be worse than stale.
const followFocus = (
  state: WindowState,
  focusedId: string | undefined,
): WindowState =>
  focusedId === undefined || windowOf(state, focusedId) === undefined
    ? state
    : reachWindow(state, focusedId);

/**
 * The user reached a window: it takes the keyboard, and comes to the front if
 * it floats.
 *
 * The workspace it is on comes with it. Picking a window that is not on screen
 * is something only a client's own ask can do — `xdg-activation`, which this
 * shell grants — and going there is what makes granting it mean anything.
 */
const reachWindow = (state: WindowState, id: string): WindowState => {
  const workspace = workspaceHolding(state, id);
  if (workspace === undefined) {
    return state;
  } else {
    const found = reached(workspace, id);
    if (found === workspace && workspace.name === state.current) {
      // A reach that moved nothing gives back the state it was given, object
      // and all — which is what `AppWindow` says it relies on for the press
      // it reports in the window the user is already in. Rebuilt anyway, the
      // desktop re-renders on every click in the window being worked in.
      //
      // Only a tiled window comes back the same, because only the tiling has
      // a focus that can already be where it is being put: a float is raised
      // as well as focused, and a raise is a new order of the stack.
      return state;
    } else {
      return onWorkspace(
        workspace.name === state.current
          ? state
          : { ...state, current: workspace.name, previous: state.current },
        workspace.name,
        () => found,
      );
    }
  }
};

// The window under the pointer is the window the keyboard is in, which is the
// whole of this shell's focus policy. What it does not do is raise: a window
// that came to the front for being crossed would cover the one the user was
// heading for, and the pointer would have rearranged the desktop on the way
// there.
const pointAtWindow = (state: WindowState, id: string): WindowState => {
  const workspace = workspaceOn(state);
  if (!holds(workspace, id)) {
    return state;
  } else if (focusedOn(workspace) === id) {
    // The same object for a pointer that never left: a window says this again
    // for every part of it that is an element of its own — a browser window's
    // address bar, its page — and none of those is the user reaching anywhere.
    return state;
  } else {
    return onCurrent(state, (found) => pointedAt(found, id));
  }
};

// A fact the client reported about its own window, written onto the shell's
// record of it. A message naming a client the shell has no window for leaves
// the list as it is, the same way a close for one does: the host drains its
// events for a portal that has already been torn down here.
const reshapeApp = (
  state: WindowState,
  appId: string,
  into: (window: ClientWindow) => ClientWindow,
): WindowState => ({
  ...state,
  windows: state.windows.map((window) =>
    window.kind === WindowKind.App && window.appId === appId
      ? into(window)
      : window,
  ),
});

const renameWindow = (
  state: WindowState,
  id: string,
  title: string,
): WindowState => ({
  ...state,
  windows: state.windows.map((window) =>
    window.id === id ? { ...window, title } : window,
  ),
});

// `workspace <name>`, with the config's `workspaceAutoBackAndForth`: naming
// the workspace already on screen goes back to the one before it.
const selectWorkspace = (state: WindowState, name: string): WindowState => {
  if (name !== state.current) {
    return { ...state, current: name, previous: state.current };
  } else if (state.previous === undefined) {
    return state;
  } else {
    return { ...state, current: state.previous, previous: state.current };
  }
};

// `move container to workspace <name>`: the window goes and the user stays,
// which is sway's default. It lands tiled there however it was laid out here.
const sendToWorkspace = (state: WindowState, name: string): WindowState => {
  const id = activeIdOf(state);
  if (id === undefined || name === state.current) {
    return state;
  } else {
    return onWorkspace(
      onCurrent(state, (workspace) => closed(workspace, id)),
      name,
      (workspace) => opened(workspace, id),
    );
  }
};

// `move scratchpad`: off every workspace, and out of the way. The window is
// still open — it is a window with nowhere on screen to be.
const hideInScratchpad = (state: WindowState): WindowState => {
  const id = activeIdOf(state);
  if (id === undefined) {
    return state;
  } else {
    return onCurrent(
      { ...state, scratchpad: [...state.scratchpad, id] },
      (workspace) => closed(workspace, id),
    );
  }
};

/**
 * `scratchpad show`: the last window hidden, floating over this workspace —
 * or the one already up, hidden again.
 *
 * Which of the two it is, is the question the float's own `scratchpad` flag
 * answers: sway's `scratchpad show` cycles a window out and back, and the
 * window being worked in is the one it acts on.
 */
const showScratchpad = (state: WindowState): WindowState => {
  const workspace = workspaceOn(state);
  const id = focusedOn(workspace);
  const up = id === undefined ? undefined : floatOn(workspace, id);
  const hidden = state.scratchpad.at(-1);
  if (up?.scratchpad === true && id !== undefined) {
    return onCurrent(
      { ...state, scratchpad: [...state.scratchpad, id] },
      (found) => closed(found, id),
    );
  } else if (hidden === undefined) {
    return state;
  } else {
    return onCurrent(
      { ...state, scratchpad: state.scratchpad.slice(0, -1) },
      (found) => shown(found, hidden),
    );
  }
};
