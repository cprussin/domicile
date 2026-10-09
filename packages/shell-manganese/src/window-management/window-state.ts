// The desktop's window state and the pure reducer that updates it.
//
// Windows, workspaces, screens and the binding mode change together, so they
// share one state. `useWindows` feeds host events and keystrokes into it.
//
// Most actions are sway commands parsed by `keyboard/command.ts`, and most
// reducer arms delegate to `workspace.ts`. See
// `packages/shell-manganese/docs/WINDOW-MANAGEMENT.md`.

import type { CursorShape } from "@domicile-desktop/sdk/cursor-shape";
import type { DomicileBrowserWindow } from "@domicile-desktop/sdk/domicile-host";

import type { PlacedScreen } from "../screens/screen-toward";
import { screenToward } from "../screens/screen-toward";
import type { Axis, Direction } from "./direction";
import type { Float } from "./floating/float";
import { floatHolds, limitedTo, movedTo } from "./floating/float";
import type { Popup } from "./popup";
import type { Rect } from "./rect";
import type { Layout } from "./tree/node";
import { NodeKind } from "./tree/node";
import type { ClientWindow, ShellWindow, SizeLimit } from "./window";
import {
  appWindowId,
  browserWindowId,
  ShellWindow as Window,
  WindowKind,
} from "./window";
import type { Workspace } from "./workspace";
import {
  childFocused,
  closed,
  containerLaidOut,
  containerSplit,
  emptyWorkspace,
  enteredBy,
  floatLanded,
  floatLifted,
  floatMoved,
  floatOn,
  floatSized,
  floatToggled,
  focusedOn,
  focusLeaves,
  focusStepped,
  fullscreenToggled,
  holds,
  modeToggled,
  opened,
  openedFloating,
  parentFocused,
  pointedOn,
  pushedOffBy,
  pushedOnBy,
  reached,
  shown,
  splitFlipped,
  tiledArrived,
  tiledDropped,
  tiledIn,
  tiledStretched,
  tiledTraded,
  windowGrown,
  windowMoved,
  windowsOn,
} from "./workspace";

/**
 * The workspace names the config binds keys to.
 *
 * All ten always exist, unlike sway's. The bar only lists non-empty ones, so
 * the user sees the same thing.
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

/**
 * The screen name used before the host describes any screens.
 *
 * No real display has this name, so nothing draws it. It gives windows that
 * open before the first description somewhere to live.
 */
export const UNDESCRIBED_SCREEN = "";

/** The empty box for {@link UNDESCRIBED_SCREEN}. */
const NOWHERE: Rect = { height: 0, width: 0, x: 0, y: 0 };

/** One screen of the desk, and the workspace it is showing. */
export type DeskScreen = PlacedScreen & {
  /** The workspace shown on it. No two screens show the same one. */
  current: string;
};

export type WindowState = {
  /**
   * The desk's screens, in order, and the workspace each shows. Never empty
   * (see {@link UNDESCRIBED_SCREEN}).
   *
   * As in sway, selecting a workspace already on screen moves the keyboard
   * there. No two screens may show the same workspace: embedding a window
   * twice takes the first embedding's pixels away.
   */
  screens: readonly DeskScreen[];
  /**
   * The screen with the keyboard, where windows open and keyed commands act.
   */
  focused: string;
  /**
   * The screen each workspace belongs to, whose bar lists it.
   *
   * As with sway's outputs, selecting a workspace shows it on its home
   * screen. A hidden workspace keeps its last screen, or moves to the focused
   * screen if that one is gone. An empty hidden workspace has no home, so it
   * opens on the focused screen next time.
   */
  homes: Readonly<Partial<Record<string, string>>>;
  /**
   * The floating window being dragged, or `undefined`.
   *
   * Kept here because it styles the window, and because releasing the
   * modifier mid-drag must not drop it.
   */
  draggingId: string | undefined;
  /**
   * The app with compositor keyboard focus, or `undefined` when the chrome
   * has it.
   *
   * Can differ from the shell's focused window, for example after a click.
   */
  focusedId: string | undefined;
  /**
   * Whether the compositor has named a window with the keyboard yet.
   *
   * The first window it names ends the replay to a newly bound page, and says
   * where the user was typing, so the shell follows it. Later reports answer
   * the shell's own asks. Following one that lands late would undo a newer
   * choice, such as a window opened from the launcher.
   */
  replayed: boolean;
  /**
   * Whether the launcher is open.
   *
   * Kept here because key commands open it and launches close it.
   */
  launcherOpen: boolean;
  /**
   * Whether the clipboard history is open. Kept here because key commands
   * open it.
   */
  clipboardOpen: boolean;
  /**
   * The binding mode: `default`, or one the config declares such as `resize`.
   *
   * Shared across the desk because consecutive keys can land on different
   * monitors' pages. Each page passes it to the SDK.
   */
  mode: string;
  /**
   * The previously shown workspace, for `workspaceAutoBackAndForth`.
   */
  previous: string | undefined;
  /**
   * Client popups such as menus and tooltips, oldest first. See `popup.ts`.
   */
  popups: readonly Popup[];
  /**
   * How many commands keys have run.
   *
   * `usePointerWarp` moves the pointer after each one. A counter lets each
   * monitor tell new presses from ones it has handled.
   */
  pressed: number;
  /** The scratchpad windows, most recently hidden last. */
  scratchpad: readonly string[];
  /**
   * Windows that asked for the keyboard (`xdg-activation`) and have not been
   * worked in since, oldest first.
   *
   * Marked rather than focused, as sway's `urgent`, so a window cannot take
   * focus from the one being worked in.
   */
  urgent: readonly string[];
  windows: readonly ShellWindow[];
  workspaces: readonly Workspace[];
};

/** The initial state: no windows open. */
export const NO_WINDOWS: WindowState = {
  clipboardOpen: false,
  draggingId: undefined,
  focused: UNDESCRIBED_SCREEN,
  focusedId: undefined,
  homes: { "1": UNDESCRIBED_SCREEN },
  launcherOpen: false,
  mode: "default",
  popups: [],
  pressed: 0,
  previous: undefined,
  replayed: false,
  scratchpad: [],
  screens: [{ box: NOWHERE, current: "1", name: UNDESCRIBED_SCREEN }],
  urgent: [],
  windows: [],
  workspaces: WORKSPACES.map((name) => emptyWorkspace(name)),
};

/**
 * The workspace `screen` is showing. Throws for an unknown screen, which is a
 * wiring bug.
 */
export const workspaceOn = (state: WindowState, screen: string): Workspace =>
  workspaceNamed(state, currentOn(state, screen));

/** The workspace with the keyboard, which keyed commands act on. */
export const workspaceHere = (state: WindowState): Workspace =>
  workspaceOn(state, state.focused);

/** The workspace `screen` is showing. */
export const currentOn = (state: WindowState, screen: string): string =>
  screenNamed(state, screen).current;

/** The workspace on the focused screen. */
export const currentHere = (state: WindowState): string =>
  currentOn(state, state.focused);

/** The focused screen's box on the desk. */
const screenHere = (state: WindowState): Rect =>
  screenNamed(state, state.focused).box;

/** The screen called `name`. Throws for an unknown screen. */
const screenNamed = (state: WindowState, name: string): DeskScreen => {
  const found = state.screens.find((screen) => screen.name === name);
  if (found === undefined) {
    throw new Error(`shell: no screen ${name}`);
  } else {
    return found;
  }
};

/** The screen showing `workspace`, or `undefined` while none is. */
export const screenShowing = (
  state: WindowState,
  workspace: string,
): string | undefined =>
  state.screens.find(({ current }) => current === workspace)?.name;

/** The workspaces `screen`'s bar lists, in order. */
export const workspacesOn = (
  state: WindowState,
  screen: string,
): readonly string[] =>
  WORKSPACES.filter((name) => state.homes[name] === screen);

/** The workspaces holding a window that asked for the keyboard. */
export const urgentWorkspacesOf = (state: WindowState): readonly string[] =>
  state.workspaces
    .filter((workspace) => state.urgent.some((id) => holds(workspace, id)))
    .map(({ name }) => name);

/** The workspace called `name`. Throws for an unknown name. */
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

/**
 * The screen showing the client `appId`'s window, or `undefined` while none
 * is.
 */
export const screenOfApp = (
  state: WindowState,
  appId: string,
): string | undefined => {
  const workspace = workspaceHolding(state, appWindowId(appId));
  return workspace === undefined
    ? undefined
    : screenShowing(state, workspace.name);
};

/** The focused window, or `undefined` on an empty workspace. */
export const activeIdOf = (state: WindowState): string | undefined =>
  focusedOn(workspaceHere(state));

/** The window `id`, or `undefined` for one that has closed. */
export const windowOf = (
  state: WindowState,
  id: string,
): ShellWindow | undefined => state.windows.find((window) => window.id === id);

export enum WindowActionKind {
  AppAppeared,
  AppClosed,
  AppCursorChanged,
  AppMaxSize,
  AppMinSize,
  AppTitled,
  AppLaunched,
  BrowserOpened,
  BrowserWindowsListed,
  ChildFocused,
  ClipboardDismissed,
  ClipboardToggled,
  CommandExecuted,
  ContainerSplit,
  DeskLocked,
  FileOpened,
  FloatToggled,
  FocusChanged,
  FocusRequested,
  FocusStepped,
  FullscreenToggled,
  KeyPressed,
  LauncherDismissed,
  LauncherToggled,
  LayoutSet,
  ModeSet,
  ModeSwapped,
  ParentFocused,
  PopupPlaced,
  ScratchpadShown,
  ScreenHovered,
  ScreenshotTaken,
  ScreensDescribed,
  SplitToggled,
  WindowClosed,
  WindowDropped,
  WindowDroppedOn,
  WindowDroppedOnScreen,
  WindowFloated,
  WindowFullscreened,
  WindowGrabbed,
  WindowGrown,
  WindowHovered,
  WindowKilled,
  WindowMoved,
  WindowResized,
  WindowSelected,
  WindowSentToScratchpad,
  WindowSentToWorkspace,
  WindowStepped,
  WindowStretched,
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
   * The user picked an application in the launcher. The compositor runs
   * `command`; the reducer only closes the launcher.
   */
  AppLaunched: (command: readonly string[]) => ({
    command,
    kind: WindowActionKind.AppLaunched as const,
  }),

  /** The client said the largest it will draw its window. */
  AppMaxSize: (appId: string, size: SizeLimit) => ({
    appId,
    kind: WindowActionKind.AppMaxSize as const,
    size,
  }),

  /** The client said the smallest it will draw its window. */
  AppMinSize: (appId: string, size: SizeLimit) => ({
    appId,
    kind: WindowActionKind.AppMinSize as const,
    size,
  }),

  /**
   * The client set or cleared its window title.
   *
   * Separate from {@link WindowAction.AppAppeared} because `set_title` comes
   * after creation and repeats on every change.
   */
  AppTitled: (appId: string, title: string | undefined) => ({
    appId,
    kind: WindowActionKind.AppTitled as const,
    title,
  }),

  /**
   * The user opened a browser window at `src`, private or not. `useWindows`
   * asks the engine, and the window arrives in the next
   * {@link WindowAction.BrowserWindowsListed}.
   */
  BrowserOpened: (src: string, isPrivate: boolean) => ({
    isPrivate,
    kind: WindowActionKind.BrowserOpened as const,
    src,
  }),

  /**
   * The engine sent the full browser window list. New windows open, missing
   * ones close, and the rest take their page's address and title.
   */
  BrowserWindowsListed: (windows: readonly DomicileBrowserWindow[]) => ({
    kind: WindowActionKind.BrowserWindowsListed as const,
    windows,
  }),

  /** `focus child`. */
  ChildFocused: () => ({ kind: WindowActionKind.ChildFocused as const }),

  /**
   * The clipboard history closed itself: Escape, a backdrop click, or a row
   * being chosen.
   *
   * Not a toggle, which could reopen the panel as it closes.
   */
  ClipboardDismissed: () => ({
    kind: WindowActionKind.ClipboardDismissed as const,
  }),

  /**
   * `mod+shift+v`, which opens and closes the clipboard history.
   */
  ClipboardToggled: () => ({
    kind: WindowActionKind.ClipboardToggled as const,
  }),

  /**
   * `exec <argv…>`: the compositor spawns `argv`.
   *
   * Changes no state; the new window arrives as a host announcement. It is an
   * action so every key command is one.
   */
  CommandExecuted: (argv: readonly string[]) => ({
    argv,
    kind: WindowActionKind.CommandExecuted as const,
  }),

  /** `splith` / `splitv`. */
  ContainerSplit: (axis: Axis) => ({
    axis,
    kind: WindowActionKind.ContainerSplit as const,
  }),

  /**
   * The user asked the compositor to lock the desk.
   *
   * Changes no state; the lock screen follows the host's `locked` message.
   */
  DeskLocked: () => ({ kind: WindowActionKind.DeskLocked as const }),

  /**
   * The user picked a file in the launcher; the compositor opens it with the
   * default application.
   *
   * Only closes the launcher; the app's window arrives from the host. `path`
   * is relative to the home directory or absolute (see
   * `launcher/open-command.ts`).
   */
  FileOpened: (path: string) => ({
    kind: WindowActionKind.FileOpened as const,
    path,
  }),

  /** `floating toggle`. */
  FloatToggled: () => ({ kind: WindowActionKind.FloatToggled as const }),

  /**
   * The compositor moved keyboard focus. `undefined` means the chrome has it.
   *
   * Also reports focus changes the shell did not request, such as clicks.
   */
  FocusChanged: (appId: string | undefined) => ({
    appId,
    kind: WindowActionKind.FocusChanged as const,
  }),

  /**
   * A client requested focus over `xdg-activation`. The compositor leaves the
   * decision to the shell; Manganese marks the window urgent instead (see
   * `WindowState.urgent`).
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

  /** `fullscreen`, or `fullscreen toggle global` across every screen. */
  FullscreenToggled: (global: boolean) => ({
    global,
    kind: WindowActionKind.FullscreenToggled as const,
  }),

  /**
   * A key ran a command. See {@link WindowState.pressed}.
   */
  KeyPressed: () => ({ kind: WindowActionKind.KeyPressed as const }),

  /**
   * The launcher closed itself without launching: Escape or a backdrop click.
   *
   * Not a toggle, which could reopen the panel as it closes.
   */
  LauncherDismissed: () => ({
    kind: WindowActionKind.LauncherDismissed as const,
  }),

  /**
   * `mod+space`, which opens and closes the launcher.
   */
  LauncherToggled: () => ({ kind: WindowActionKind.LauncherToggled as const }),

  /** `layout tabbed` / `layout stacking`. */
  LayoutSet: (layout: Layout) => ({
    kind: WindowActionKind.LayoutSet as const,
    layout,
  }),

  /**
   * A key changed the binding mode, such as `mode resize` or `mode default`.
   */
  ModeSet: (mode: string) => ({
    kind: WindowActionKind.ModeSet as const,
    mode,
  }),

  /** `focus mode_toggle`: switch focus between floating and tiled windows. */
  ModeSwapped: () => ({ kind: WindowActionKind.ModeSwapped as const }),

  /** `focus parent`. */
  ParentFocused: () => ({ kind: WindowActionKind.ParentFocused as const }),

  /** A client opened a popup over one of its windows, or moved one. */
  PopupPlaced: (popup: Popup) => ({
    kind: WindowActionKind.PopupPlaced as const,
    popup,
  }),

  /** `scratchpad show`. */
  ScratchpadShown: () => ({ kind: WindowActionKind.ScratchpadShown as const }),

  /**
   * The pointer moved on a screen, which focuses it even with no window under
   * the pointer. See {@link WindowAction.WindowHovered} for windows.
   */
  ScreenHovered: (name: string) => ({
    kind: WindowActionKind.ScreenHovered as const,
    name,
  }),

  /**
   * The host described the desk's screens, in order.
   *
   * Only changes which workspaces are visible. Existing screens keep their
   * workspace, a replacement monitor takes over its predecessor's, and a new
   * monitor gets an unused one.
   */
  ScreensDescribed: (screens: readonly PlacedScreen[]) => ({
    kind: WindowActionKind.ScreensDescribed as const,
    screens,
  }),

  /**
   * The user asked for a screenshot.
   *
   * Changes no state; the compositor freezes the desk and `<PortalDialogs />`
   * draws the dialog.
   */
  ScreenshotTaken: () => ({
    kind: WindowActionKind.ScreenshotTaken as const,
  }),

  /** `layout toggle split`. */
  SplitToggled: () => ({ kind: WindowActionKind.SplitToggled as const }),

  /** The user closed a window from its title bar. */
  WindowClosed: (id: string) => ({
    id,
    kind: WindowActionKind.WindowClosed as const,
  }),

  /** The user released the window being dragged. */
  WindowDropped: () => ({ kind: WindowActionKind.WindowDropped as const }),

  /**
   * The user dropped a tiled window on `target`'s `edge`, or its middle when
   * `edge` is `undefined`.
   *
   * Sent alongside {@link WindowAction.WindowDropped}, which ends the drag.
   */
  WindowDroppedOn: (
    id: string,
    target: string,
    edge: Direction | undefined,
  ) => ({
    edge,
    id,
    kind: WindowActionKind.WindowDroppedOn as const,
    target,
  }),

  /**
   * The user dropped a tiled window on screen `screen`, which has nothing
   * tiled on it.
   *
   * Sent alongside {@link WindowAction.WindowDropped}, which ends the drag.
   */
  WindowDroppedOnScreen: (id: string, screen: string) => ({
    id,
    kind: WindowActionKind.WindowDroppedOnScreen as const,
    screen,
  }),

  /**
   * The user pressed the float button on window `id`'s title bar.
   *
   * Unlike {@link WindowAction.FloatToggled}, it targets a named window.
   */
  WindowFloated: (id: string) => ({
    id,
    kind: WindowActionKind.WindowFloated as const,
  }),

  /**
   * The user pressed the fullscreen button on window `id`'s title bar.
   *
   * Unlike {@link WindowAction.FullscreenToggled}, it targets a named window.
   * Never global, so the button cannot spread a window onto screens the user
   * is not looking at.
   */
  WindowFullscreened: (id: string) => ({
    id,
    kind: WindowActionKind.WindowFullscreened as const,
  }),

  /**
   * The user started dragging a floating window to move or resize it. Both
   * are the same drag here.
   */
  WindowGrabbed: (id: string) => ({
    id,
    kind: WindowActionKind.WindowGrabbed as const,
  }),

  /** `resize grow` / `resize shrink`, as bound in resize mode. */
  WindowGrown: (direction: Direction) => ({
    direction,
    kind: WindowActionKind.WindowGrown as const,
  }),

  /**
   * The pointer entered a window, which focuses it. A hidden tab counts as
   * its container's open tab (see `pointedOn`).
   *
   * Clicks are {@link WindowAction.WindowSelected}.
   */
  WindowHovered: (id: string) => ({
    id,
    kind: WindowActionKind.WindowHovered as const,
  }),

  /** `kill`: close the focused window. */
  WindowKilled: () => ({ kind: WindowActionKind.WindowKilled as const }),

  /**
   * The user dragged a floating window to `x`, `y` in desk pixels (see
   * `floatDragged`).
   */
  WindowMoved: (id: string, x: number, y: number) => ({
    id,
    kind: WindowActionKind.WindowMoved as const,
    x,
    y,
  }),

  /**
   * The user resized a floating window by a corner, which can also move it.
   */
  WindowResized: (id: string, box: Rect) => ({
    box,
    id,
    kind: WindowActionKind.WindowResized as const,
  }),

  /** The user clicked in a window or on its title bar. */
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

  /**
   * The user dragged a tiled window's `edge` `by` pixels (positive is right
   * or down).
   *
   * `area` is the workspace's layout box, needed to convert pixels to the
   * tree's shares. Only the showing monitor knows it.
   */
  WindowStretched: (id: string, edge: Direction, by: number, area: Rect) => ({
    area,
    by,
    edge,
    id,
    kind: WindowActionKind.WindowStretched as const,
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
): WindowState =>
  answered(rehomed(limited(state, reduceAction(state, action))));

const reduceAction = (
  state: WindowState,
  action: WindowAction,
): WindowState => {
  switch (action.kind) {
    case WindowActionKind.AppAppeared: {
      return openApp(state, action.appId, action.title);
    }
    case WindowActionKind.AppClosed: {
      // Popups and windows share one id space without overlap.
      return state.popups.some(({ appId }) => appId === action.appId)
        ? {
            ...state,
            popups: state.popups.filter(({ appId }) => appId !== action.appId),
          }
        : closeWindow(state, appWindowId(action.appId));
    }
    case WindowActionKind.AppCursorChanged: {
      return reshapeApp(state, action.appId, (window) => ({
        ...window,
        cursor: action.cursor,
      }));
    }
    case WindowActionKind.AppMaxSize: {
      return reshapeApp(state, action.appId, (window) => ({
        ...window,
        maxSize: action.size,
      }));
    }
    case WindowActionKind.AppMinSize: {
      return reshapeApp(state, action.appId, (window) => ({
        ...window,
        minSize: action.size,
      }));
    }
    case WindowActionKind.AppTitled: {
      // Same fallback as on open; the SDK reads `set_title("")` as no title.
      return renameWindow(
        state,
        appWindowId(action.appId),
        action.title ?? action.appId,
      );
    }
    case WindowActionKind.BrowserOpened: {
      // Closes the launcher, since opening a URL is one of its results. The
      // window itself arrives with the engine's next list.
      return { ...state, launcherOpen: false };
    }
    case WindowActionKind.BrowserWindowsListed: {
      return listBrowsers(state, action.windows);
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
    case WindowActionKind.AppLaunched:
    case WindowActionKind.FileOpened: {
      // The host announces the new window. Only the launcher closes here.
      return { ...state, launcherOpen: false };
    }
    case WindowActionKind.FloatToggled: {
      return onCurrent(state, (workspace) =>
        floatToggled(workspace, screenHere(state)),
      );
    }
    case WindowActionKind.FocusChanged: {
      const focusedId =
        action.appId === undefined ? undefined : appWindowId(action.appId);
      // Return the same object when unchanged so React skips re-rendering.
      // A newly connected chrome is told the current holder, usually a no-op.
      if (focusedId === state.focusedId) {
        return state;
      } else {
        const told = { ...state, focusedId };
        return state.replayed ? told : followFocus(told, focusedId);
      }
    }
    case WindowActionKind.FocusRequested: {
      return askedFor(state, appWindowId(action.appId));
    }
    case WindowActionKind.FocusStepped: {
      return stepFocus(state, action.direction);
    }
    case WindowActionKind.FullscreenToggled: {
      return onCurrent(state, (workspace) =>
        fullscreenToggled(workspace, action.global),
      );
    }
    case WindowActionKind.KeyPressed: {
      return { ...state, pressed: state.pressed + 1 };
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
    case WindowActionKind.PopupPlaced: {
      // Moved in place rather than appended, so a menu keeps its order.
      const placed = action.popup;
      return {
        ...state,
        popups: state.popups.some(({ appId }) => appId === placed.appId)
          ? state.popups.map((popup) =>
              popup.appId === placed.appId ? placed : popup,
            )
          : [...state.popups, placed],
      };
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
    case WindowActionKind.DeskLocked: {
      // The compositor locks it and the host says so.
      return state;
    }
    case WindowActionKind.ScreenshotTaken: {
      // The compositor takes it, through the portal dialog.
      return state;
    }
    case WindowActionKind.CommandExecuted: {
      // The compositor spawns it and the host announces the window it opens.
      return state;
    }
    // A request only. A client may refuse, for example with unsaved work, and
    // the engine closes a browser window. The window is removed on the next
    // `app_closed` or `browser_windows`. `useWindows` sends the request.
    case WindowActionKind.WindowClosed: {
      return state;
    }
    case WindowActionKind.WindowDropped: {
      return { ...state, draggingId: undefined };
    }
    case WindowActionKind.WindowDroppedOn: {
      return dropWindow(state, action.id, action.target, action.edge);
    }
    case WindowActionKind.WindowDroppedOnScreen: {
      return dropOnScreen(state, action.id, action.screen);
    }
    case WindowActionKind.WindowFloated: {
      // Focus the window first, as for `WindowFullscreened`. Reaching it also
      // focuses its screen, which the float is placed on.
      const reached = reachWindow(state, action.id);
      return onWorkspaceWith(reached, action.id, (workspace) =>
        floatToggled(workspace, screenHere(reached)),
      );
    }
    case WindowActionKind.WindowFullscreened: {
      // Focus the window first: `fullscreenToggled` acts on the focused
      // window, and pressing a bar focuses its window anyway.
      return onWorkspaceWith(
        reachWindow(state, action.id),
        action.id,
        (workspace) => fullscreenToggled(workspace, false),
      );
    }
    case WindowActionKind.WindowGrabbed: {
      // A grab focuses and raises the window, like a click.
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
    // A request only; see `WindowClosed`.
    case WindowActionKind.WindowKilled: {
      return state;
    }
    case WindowActionKind.WindowMoved: {
      return floatDragged(state, action.id, action.x, action.y);
    }
    case WindowActionKind.WindowResized: {
      return onWorkspaceWith(state, action.id, (workspace) =>
        floatSized(workspace, action.id, action.box),
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
      return stepWindow(state, action.direction);
    }
    case WindowActionKind.WindowStretched: {
      return onWorkspaceWith(state, action.id, (workspace) =>
        tiledStretched(
          workspace,
          action.id,
          action.edge,
          action.by,
          action.area,
        ),
      );
    }
    case WindowActionKind.ScreenHovered: {
      return pointAtScreen(state, action.name);
    }
    case WindowActionKind.ScreensDescribed: {
      return describeScreens(state, action.screens);
    }
    case WindowActionKind.WorkspaceSelected: {
      return selectWorkspace(state, action.name);
    }
  }
};

// Applies `into` to the focused screen's workspace, as most commands do.
const onCurrent = (
  state: WindowState,
  into: (workspace: Workspace) => Workspace,
): WindowState => onWorkspace(state, currentHere(state), into);

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

// Applies `into` to the workspace holding `id`. No-op for a window on no
// workspace, such as a scratchpad or already closed one.
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

/**
 * `focus <direction>`: within the current workspace, then on to the next
 * screen before wrapping, as in sway. Empty screens are valid targets.
 */
const stepFocus = (state: WindowState, direction: Direction): WindowState => {
  const beyond = screenToward(state.screens, state.focused, direction);
  if (beyond !== undefined && focusLeaves(workspaceHere(state), direction)) {
    return onWorkspace(
      { ...state, focused: beyond },
      currentOn(state, beyond),
      (workspace) => enteredBy(workspace, direction),
    );
  } else {
    return onCurrent(state, (workspace) => focusStepped(workspace, direction));
  }
};

/**
 * `move <direction>`: within the current workspace, then on to the next
 * screen, as in sway. Focus follows the window.
 */
const stepWindow = (state: WindowState, direction: Direction): WindowState => {
  const beyond = screenToward(state.screens, state.focused, direction);
  const leaving =
    beyond === undefined
      ? undefined
      : pushedOffBy(workspaceHere(state), direction);
  if (beyond === undefined || leaving === undefined) {
    return onCurrent(state, (workspace) => windowMoved(workspace, direction));
  } else {
    const left = onCurrent(state, () => leaving.rest);
    return onWorkspace(
      { ...left, focused: beyond },
      currentOn(state, beyond),
      (workspace) => pushedOnBy(workspace, leaving.node, direction),
    );
  }
};

// Ignores a re-announcement of a known client; portals are keyed by app id.
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

// Applies the engine's list: closes windows it no longer lists, then opens or
// updates each listed one. The list is in open order, so windows tile in that
// order.
const listBrowsers = (
  state: WindowState,
  listed: readonly DomicileBrowserWindow[],
): WindowState => {
  const ids = new Set(listed.map(({ id }) => browserWindowId(id)));
  const kept = state.windows
    .filter(({ id, kind }) => kind === WindowKind.Browser && !ids.has(id))
    .reduce((left, { id }) => closeWindow(left, id), state);
  return listed.reduce(takeUpBrowser, kept);
};

// Opens a listed window the shell does not have yet. Otherwise updates its
// address and title.
const takeUpBrowser = (
  state: WindowState,
  { height, id, isPrivate, popupWindow, url, width }: DomicileBrowserWindow,
): WindowState => {
  const window = Window.Browser(id, url, popupWindow ?? undefined, isPrivate);
  if (windowOf(state, window.id) !== undefined) {
    return {
      ...state,
      windows: state.windows.map((drawn) =>
        drawn.id === window.id ? window : drawn,
      ),
    };
  } else if (window.popupWindow === undefined) {
    return openWindow(state, window);
  } else {
    return openPopupWindow(state, window, width, height);
  }
};

// Extension popups float at their requested size, as sway floats dialogs; a
// tile would ignore the size the page was designed for.
const openPopupWindow = (
  state: WindowState,
  window: ShellWindow,
  width: number,
  height: number,
): WindowState =>
  onCurrent({ ...state, windows: [...state.windows, window] }, (workspace) =>
    openedFloating(workspace, window.id, screenHere(state), width, height),
  );

// New windows tile on the current workspace and take focus, as in sway.
const openWindow = (state: WindowState, window: ShellWindow): WindowState =>
  onCurrent({ ...state, windows: [...state.windows, window] }, (workspace) =>
    opened(workspace, window.id),
  );

// Removes a window from the list, its workspace and the scratchpad. Unknown
// ids are a no-op, since the host may drain events for a torn-down portal.
const closeWindow = (state: WindowState, id: string): WindowState => ({
  ...state,
  draggingId: state.draggingId === id ? undefined : state.draggingId,
  scratchpad: state.scratchpad.filter((hidden) => hidden !== id),
  windows: state.windows.filter((window) => window.id !== id),
  workspaces: state.workspaces.map((workspace) =>
    holds(workspace, id) ? closed(workspace, id) : workspace,
  ),
});

// Follows compositor focus to its window and that window's workspace, so the
// user can see where they are typing, and ends the replay (see
// `WindowState.replayed`). Focus on the chrome or an unknown window keeps the
// current focus, since a stale value beats `undefined`.
const followFocus = (
  state: WindowState,
  focusedId: string | undefined,
): WindowState =>
  focusedId === undefined || windowOf(state, focusedId) === undefined
    ? state
    : reachWindow({ ...state, replayed: true }, focusedId);

/**
 * Focuses a window, raising it if it floats, and shows its workspace.
 *
 * Switching to its workspace is what makes reaching an off-screen window, such
 * as a browser window an extension raises, visible.
 */
const reachWindow = (state: WindowState, id: string): WindowState => {
  const workspace = workspaceHolding(state, id);
  if (workspace === undefined) {
    return state;
  } else {
    const found = reached(workspace, id);
    const shown = showWorkspace(state, workspace.name);
    if (found === workspace && shown === state) {
      // Return the same object when nothing changed. `AppWindow` relies on
      // this to avoid re-rendering the desktop on every click in the focused
      // window. Floats never hit this branch, since reaching one raises it.
      return state;
    } else {
      return onWorkspace(shown, workspace.name, () => found);
    }
  }
};

/**
 * Shows workspace `name` and focuses its screen.
 *
 * As in sway, a workspace already on screen is reached by moving the keyboard
 * there, so no two screens show it. A hidden one opens on its home screen
 * (see {@link WindowState.homes}), or the focused screen if it has none.
 */
const showWorkspace = (state: WindowState, name: string): WindowState => {
  const shown = screenShowing(state, name);
  const home = state.homes[name] ?? state.focused;
  if (shown === state.focused) {
    // Same object, which `reachWindow` passes on for `AppWindow`.
    return state;
  } else if (shown === undefined) {
    return {
      ...state,
      focused: home,
      previous: currentHere(state),
      screens: state.screens.map((screen) =>
        screen.name === home ? { ...screen, current: name } : screen,
      ),
    };
  } else {
    return { ...state, focused: shown };
  }
};

// Focus follows the pointer, and hovering a float raises it like a click.
// Done here because the compositor does not know about browser windows.
const pointAtWindow = (state: WindowState, id: string): WindowState => {
  // Focus moves to the window's own screen. A window on a hidden workspace
  // cannot be under the pointer, so it is ignored.
  const workspace = workspaceHolding(state, id);
  const screen =
    workspace === undefined ? undefined : screenShowing(state, workspace.name);
  if (workspace === undefined || screen === undefined) {
    return state;
  } else {
    return pointAtShown(state, workspace, screen, pointedOn(workspace, id));
  }
};

// Focuses `id`, shown on `screen`, when the pointer enters it.
const pointAtShown = (
  state: WindowState,
  workspace: Workspace,
  screen: string,
  id: string,
): WindowState =>
  // Same object when already focused: each element in a window (such as a
  // browser's address bar and page) reports the hover again.
  focusedOn(workspace) === id && state.focused === screen
    ? state
    : onWorkspace({ ...state, focused: screen }, workspace.name, (found) =>
        reached(found, id),
      );

// Focuses the screen under the pointer. Same object when it is already
// focused (this fires on every move) or not yet described by the host.
const pointAtScreen = (state: WindowState, name: string): WindowState =>
  state.focused === name ||
  !state.screens.some((screen) => screen.name === name)
    ? state
    : { ...state, focused: name };

// Updates a client's window record. Unknown clients are a no-op, since the
// host may drain events for a torn-down portal.
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

/**
 * Applies the host's screen list, one screen per display, in order.
 *
 * Runs on every hotplug, so workspaces must stay put. An existing screen
 * keeps its workspace. A new display takes over a removed screen's workspace
 * (a different dock renames every monitor), else the lowest unused one. No
 * two screens show one workspace.
 *
 * With no displays, keeps one {@link UNDESCRIBED_SCREEN} so open windows
 * still have a workspace.
 */
const describeScreens = (
  state: WindowState,
  described: readonly PlacedScreen[],
): WindowState => {
  const kept =
    described.length === 0
      ? [{ box: NOWHERE, name: UNDESCRIBED_SCREEN }]
      : described;
  const names = kept.map(({ name }) => name);
  // Workspaces of removed screens, in order, for new displays to inherit.
  const replaced = state.screens
    .filter((screen) => !names.includes(screen.name))
    .map(({ current }) => current);
  const screens = kept.reduce<readonly DeskScreen[]>(
    (placed, { box, name }) => [
      ...placed,
      { box, current: showing(state, placed, replaced, name), name },
    ],
    [],
  );
  return {
    ...state,
    focused: focusedAmong(screens, state.focused),
    screens,
  };
};

/** The workspace a screen shows after the desk is re-described. */
const showing = (
  state: WindowState,
  placed: readonly DeskScreen[],
  replaced: readonly string[],
  name: string,
): string => {
  const before = state.screens.find((screen) => screen.name === name);
  const taken = placed.map(({ current }) => current);
  const inherited = replaced.find((workspace) => !taken.includes(workspace));
  const free = WORKSPACES.find(
    (workspace) =>
      !taken.includes(workspace) &&
      !state.screens.some((screen) => screen.current === workspace),
  );
  if (before !== undefined) {
    return before.current;
  } else if (inherited !== undefined) {
    return inherited;
  } else if (free === undefined) {
    // More than ten monitors. Showing a workspace twice is not allowed.
    throw new Error(`shell: no workspace left for screen ${name}`);
  } else {
    return free;
  }
};

/** The focused screen among `screens`: `focused` if present, else the first. */
const focusedAmong = (
  screens: readonly DeskScreen[],
  focused: string,
): string => {
  const first = screens[0];
  if (first === undefined) {
    throw new Error("shell: a desk is never no screens at all");
  } else {
    return screens.some(({ name }) => name === focused) ? focused : first.name;
  }
};

// `workspace <name>`. With `workspaceAutoBackAndForth`, naming the current
// workspace goes back to the previous one.
const selectWorkspace = (state: WindowState, name: string): WindowState => {
  if (name !== currentHere(state)) {
    return showWorkspace(state, name);
  } else if (state.previous === undefined) {
    return state;
  } else {
    return showWorkspace(state, state.previous);
  }
};

/**
 * Moves a dragged float to `x`, `y` in desk pixels, and onto the screen its
 * center is now over, like sway's `floating_fix_coordinates`.
 *
 * Float coordinates are relative to their screen's box. A center over no
 * screen keeps the current one. A float on a hidden workspace (switched away
 * mid-drag) does not move.
 */
const floatDragged = (
  state: WindowState,
  id: string,
  x: number,
  y: number,
): WindowState => {
  const workspace = workspaceHolding(state, id);
  const home =
    workspace === undefined ? undefined : screenShowing(state, workspace.name);
  if (workspace === undefined || home === undefined) {
    return state;
  } else {
    const here = boxOf(state, home);
    const moved = movedTo(floatHeld(workspace, id), x - here.x, y - here.y);
    const onto = screenAt(state, middleOf(moved, here)) ?? home;
    if (onto === home) {
      return onWorkspace(state, workspace.name, (found) =>
        floatMoved(found, id, moved.x, moved.y),
      );
    } else {
      const there = boxOf(state, onto);
      const arrived = movedTo(moved, x - there.x, y - there.y);
      // Focus follows, since the pointer is already on that screen.
      return onWorkspace(
        onWorkspace({ ...state, focused: onto }, workspace.name, (found) =>
          floatLifted(found, id),
        ),
        currentOn(state, onto),
        (found) => floatLanded(found, arrived),
      );
    }
  }
};

/**
 * A tiled window dropped on `target`, on its own workspace or another screen's.
 * Focus goes with it. No-op if either closed during the drag.
 */
const dropWindow = (
  state: WindowState,
  id: string,
  target: string,
  edge: Direction | undefined,
): WindowState => {
  const from = workspaceHolding(state, id);
  const to = workspaceHolding(state, target);
  const screen = to === undefined ? undefined : screenShowing(state, to.name);
  if (from === undefined || to === undefined || screen === undefined) {
    return state;
  } else if (from.name === to.name) {
    return onWorkspace(state, from.name, (workspace) =>
      tiledDropped(workspace, id, target, edge),
    );
  } else {
    // A middle drop swaps, so the target takes the window's place.
    const left = onWorkspace(state, from.name, (workspace) =>
      edge === undefined
        ? tiledTraded(workspace, id, target)
        : closed(workspace, id),
    );
    return onWorkspace({ ...left, focused: screen }, to.name, (workspace) =>
      tiledArrived(workspace, id, target, edge),
    );
  }
};

/**
 * A tiled window dropped on a screen with nothing tiled on it. Focus goes with
 * it. No-op if it closed during the drag.
 */
const dropOnScreen = (
  state: WindowState,
  id: string,
  screen: string,
): WindowState => {
  const from = workspaceHolding(state, id);
  if (from === undefined) {
    return state;
  } else {
    const left = onWorkspace(state, from.name, (workspace) =>
      closed(workspace, id),
    );
    return onWorkspace(
      { ...left, focused: screen },
      currentOn(state, screen),
      (workspace) => tiledIn(workspace, id),
    );
  }
};

/** The box of screen `name` on the desk. */
const boxOf = (state: WindowState, name: string): Rect => {
  const screen = state.screens.find((found) => found.name === name);
  if (screen === undefined) {
    throw new Error(`shell: no screen ${name}`);
  } else {
    return screen.box;
  }
};

/** The float holding `id`. Throws for a tiled window. */
const floatHeld = (workspace: Workspace, id: string): Float => {
  const float = floatOn(workspace, id);
  if (float === undefined) {
    throw new Error(`shell: window ${id} is not floating`);
  } else {
    return float;
  }
};

/** The center of a float on the screen at `box`, in desk pixels. */
const middleOf = (float: Float, box: Rect): readonly [number, number] => [
  box.x + float.x + float.width / 2,
  box.y + float.y + float.height / 2,
];

/**
 * The screen at `point`, or `undefined`. Edges are half-open like
 * `screenUnder`, so a shared edge belongs to the screen that starts there.
 */
const screenAt = (
  state: WindowState,
  [x, y]: readonly [number, number],
): string | undefined =>
  state.screens.find(
    ({ box }) =>
      x >= box.x &&
      x < box.x + box.width &&
      y >= box.y &&
      y < box.y + box.height,
  )?.name;

// `move container to workspace <name>`: the window moves and focus stays, as
// in sway. It always arrives tiled.
const sendToWorkspace = (state: WindowState, name: string): WindowState => {
  const id = activeIdOf(state);
  if (id === undefined || name === currentHere(state)) {
    return state;
  } else {
    return onWorkspace(
      onCurrent(state, (workspace) => closed(workspace, id)),
      name,
      (workspace) => tiledIn(workspace, id),
    );
  }
};

// `move scratchpad`: removes the focused window from its workspace without
// closing it.
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
 * `scratchpad show`: hides the focused scratchpad float, or else shows the
 * most recently hidden window as a float, as sway cycles them.
 */
const showScratchpad = (state: WindowState): WindowState => {
  const workspace = workspaceHere(state);
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
      (found) => shown(found, hidden, screenHere(state)),
    );
  }
};

/**
 * Updates {@link WindowState.homes} after a reduction. Returns the same object
 * when nothing changed, which no-op reductions rely on.
 */
const rehomed = (state: WindowState): WindowState => {
  const homes = Object.fromEntries(
    state.workspaces.flatMap((workspace) => {
      const home = homeOf(state, workspace);
      return home === undefined ? [] : [[workspace.name, home]];
    }),
  );
  return WORKSPACES.every((name) => homes[name] === state.homes[name])
    ? state
    : { ...state, homes };
};

// Marks window `id` urgent. `answered` drops the mark again when the window is
// the one being worked in, or has closed.
const askedFor = (state: WindowState, id: string): WindowState =>
  state.urgent.includes(id)
    ? state
    : { ...state, urgent: [...state.urgent, id] };

// Drops the urgent marks of the window being worked in and of closed windows.
// The same object when none dropped.
const answered = (state: WindowState): WindowState => {
  const active = activeIdOf(state);
  const urgent = state.urgent.filter(
    (id) => id !== active && windowOf(state, id) !== undefined,
  );
  return urgent.length === state.urgent.length ? state : { ...state, urgent };
};

/** The screen `workspace` now belongs to, or `undefined` for none. */
const homeOf = (
  state: WindowState,
  workspace: Workspace,
): string | undefined => {
  const shown = screenShowing(state, workspace.name);
  const before = state.homes[workspace.name];
  if (shown !== undefined) {
    return shown;
  } else if (windowsOn(workspace).length === 0) {
    return undefined;
  } else if (
    before !== undefined &&
    state.screens.some(({ name }) => name === before)
  ) {
    return before;
  } else {
    return state.focused;
  }
};

/**
 * Clamps each single-window float to its client's size limits (see
 * `limitedTo`).
 *
 * Runs after every action because a client can report limits after it
 * floats. Floating groups are skipped, since no one client's limits apply to
 * the shared box.
 */
const limited = (before: WindowState, after: WindowState): WindowState => {
  const workspaces = after.workspaces.map((workspace) =>
    limitedFloats(before, after, workspace),
  );
  return workspaces.every(
    (workspace, index) => workspace === after.workspaces[index],
  )
    ? after
    : { ...after, workspaces };
};

const limitedFloats = (
  before: WindowState,
  after: WindowState,
  workspace: Workspace,
): Workspace => {
  const floats = workspace.floats.map((float) => {
    const { root } = float;
    const window =
      root.kind === NodeKind.Window
        ? after.windows.find(({ id }) => id === root.id)
        : undefined;
    return window?.kind === WindowKind.App
      ? limitedTo(
          float,
          floatBefore(before, window.id),
          window.minSize,
          window.maxSize,
        )
      : float;
  });
  return floats.every((float, index) => float === workspace.floats[index])
    ? workspace
    : { ...workspace, floats };
};

/** The float holding `id` before the action, if any. */
const floatBefore = (state: WindowState, id: string) =>
  state.workspaces
    .flatMap(({ floats }) => floats)
    .find((float) => floatHolds(float, id));
