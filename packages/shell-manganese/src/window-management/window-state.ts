// Every change the desktop can undergo, as one pure reduction.
//
// The shell owns three things: which windows exist, which workspace each of
// them is on, and which binding mode the keys are read in. They move together — a window
// that opens lands on the workspace being looked at, a window sent to the
// scratchpad leaves every workspace — so they are one state, reduced in one
// place, with no DOM or domicile client in sight. `useWindows` is what feeds
// host events and keystrokes into it.
//
// **The actions are sway's commands.** `keyboard/command.ts` reads the words a
// key the config binds sends — `send-shell focus left` — into one of the
// constructors below, so the desktop's vocabulary is the one the user's config
// is written in: `focus left`, `move container to workspace 2`, `layout
// tabbed`. What a command *means* is the workspace's or
// the tree's to say, and almost every arm of the reduction is one call into
// `workspace.ts`.

import type { CursorShape } from "@domicile/sdk/cursor-shape";

import type { PlacedScreen } from "../screens/screen-toward";
import { screenToward } from "../screens/screen-toward";
import type { Axis, Direction } from "./direction";
import type { Float } from "./floating/float";
import { floatHolds, limitedTo, movedTo } from "./floating/float";
import type { Popup } from "./popup";
import type { Rect } from "./rect";
import type { Layout } from "./tree/node";
import { NodeKind } from "./tree/node";
import type {
  ClientWindow,
  PopupWindowRequest,
  ShellWindow,
  SizeLimit,
} from "./window";
import { appWindowId, ShellWindow as Window, WindowKind } from "./window";
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
  reached,
  shown,
  splitFlipped,
  tiledDropped,
  tiledIn,
  tiledStretched,
  windowGrown,
  windowMoved,
  windowsOn,
} from "./workspace";

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

/**
 * What a screen of the desk is called before the host has described one.
 *
 * No display is named the empty string — the compositor's are `drm-<id>` and
 * a config's are the user's own words — so a `<Screen name="">` draws
 * nowhere, which is exactly right: this is where the desktop is while nobody
 * can see it. A window can open in the handshake's worth of time before the
 * first description, and it has to be somewhere.
 */
export const UNDESCRIBED_SCREEN = "";

/** Where {@link UNDESCRIBED_SCREEN} is, which is nowhere. */
const NOWHERE: Rect = { height: 0, width: 0, x: 0, y: 0 };

/** One screen of the desk, and the workspace it is showing. */
export type DeskScreen = PlacedScreen & {
  /** The workspace drawn on it. No two screens show the same one. */
  current: string;
};

export type WindowState = {
  /** How many browser windows have been opened, ever — the id counter. */
  browsersOpened: number;
  /**
   * The screens of the desk, in the desk's own order, and what each shows.
   *
   * **THE WORKSPACES SPAN THE DESK AND THE SCREENS DIVIDE IT**, which is
   * sway's arrangement: a workspace is somewhere the user's work lives, a
   * screen is a view onto one of them, and asking for a workspace that is
   * already in view moves the keyboard rather than the work. Never empty —
   * see {@link UNDESCRIBED_SCREEN}.
   *
   * No two screens show the same workspace, and that is not a detail: one
   * workspace on two screens is one window embedded twice, and the second
   * embedding takes the first's pixels away.
   */
  screens: readonly DeskScreen[];
  /**
   * The screen the keyboard is on: where a window opens, and what the keyed
   * commands act on.
   */
  focused: string;
  /**
   * The screen each workspace belongs to, which is the one whose bar lists it.
   *
   * sway's outputs: a workspace is on one screen, whether or not that screen
   * is showing it, and asking for it shows it there rather than here. A
   * workspace on screen belongs to the screen showing it; a hidden one to the
   * screen it was last on, or to the screen the keyboard is on once that one
   * is gone. An empty one nobody is showing belongs nowhere — sway destroys
   * it — so the next time it is asked for it comes to the keyboard.
   */
  homes: Readonly<Partial<Record<string, string>>>;
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
   * state and not a widget's: the key that opens it is a command like every
   * other key's, and what closes it is usually something else being
   * launched. A panel that owned its own `useState` would need the keys to
   * reach into it and every launch to remember to close it.
   */
  launcherOpen: boolean;
  /**
   * Whether the clipboard's history is up.
   *
   * Desktop state for {@link WindowState.launcherOpen}'s reason: the key that
   * opens it is a command like every other key's, and a panel that owned its
   * own `useState` would need the keys to reach into it.
   */
  clipboardOpen: boolean;
  /**
   * The binding mode the keys are read in: `default`, or one the config
   * declares — `resize` in the sample.
   *
   * Desk state rather than a page's, because a key that enters a mode can
   * land on one monitor's page and the next key on another's. The SDK keeps
   * the mode the keys are read in; this is what every page tells it.
   */
  mode: string;
  /**
   * The workspace the current one was reached from, which the same key goes
   * back to (`workspaceAutoBackAndForth`).
   */
  previous: string | undefined;
  /**
   * The popups — menus, tooltips — clients have open over their windows,
   * oldest first. Not windows: see `popup.ts`.
   */
  popups: readonly Popup[];
  /**
   * How many commands a key has run.
   *
   * A key is what takes the pointer with the keyboard (`usePointerWarp`), and
   * the monitor that moves the pointer is the one the keyboard went to. Counted
   * rather than flagged so a monitor can tell a press it has not answered from
   * one it has.
   */
  pressed: number;
  /** The windows in the scratchpad, the most recently hidden last. */
  scratchpad: readonly string[];
  windows: readonly ShellWindow[];
  workspaces: readonly Workspace[];
};

/** A desktop with nothing open: what the chrome starts from. */
export const NO_WINDOWS: WindowState = {
  browsersOpened: 0,
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
  scratchpad: [],
  screens: [{ box: NOWHERE, current: "1", name: UNDESCRIBED_SCREEN }],
  windows: [],
  workspaces: WORKSPACES.map((name) => emptyWorkspace(name)),
};

/**
 * The workspace `screen` is showing. Throws for a screen the desk does not
 * have — every caller has one from {@link WindowState.screens} or from the
 * desk the host described, and a screen that is not there is a wiring bug
 * rather than an empty region.
 */
export const workspaceOn = (state: WindowState, screen: string): Workspace =>
  workspaceNamed(state, currentOn(state, screen));

/** The workspace the keyboard is in, which the keyed commands act on. */
export const workspaceHere = (state: WindowState): Workspace =>
  workspaceOn(state, state.focused);

/** The workspace `screen` is showing. */
export const currentOn = (state: WindowState, screen: string): string =>
  screenNamed(state, screen).current;

/** The workspace on the screen the keyboard is on. */
export const currentHere = (state: WindowState): string =>
  currentOn(state, state.focused);

/** Where the screen the keyboard is on is, on the desk. */
const screenHere = (state: WindowState): Rect =>
  screenNamed(state, state.focused).box;

/** The screen called `name`. Throws for one the desk does not have. */
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
  ChildFocused,
  ClipboardDismissed,
  ClipboardToggled,
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
  PopupWindowOpened,
  ScratchpadShown,
  ScreenHovered,
  ScreensDescribed,
  SplitToggled,
  TerminalLaunched,
  WindowClosed,
  WindowDropped,
  WindowDroppedOn,
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
   * The user picked an application in the launcher, whose `command` the
   * compositor runs.
   *
   * Nothing in the state moves but the panel, for
   * {@link WindowAction.FileOpened}'s reason.
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
   * The user asked for the desk to be locked, which the compositor does.
   *
   * Nothing in the state moves: the lock screen goes up when the host says the
   * desk is locked, like any other `locked` message.
   */
  DeskLocked: () => ({ kind: WindowActionKind.DeskLocked as const }),

  /**
   * The user picked a file in the launcher, which the compositor opens with
   * their default application.
   *
   * Nothing in the state moves but the panel: that application is a Wayland
   * client and its window arrives as an announcement from the host, exactly as
   * {@link WindowAction.TerminalLaunched}'s does. `path` is relative to the
   * home directory, or absolute for a file outside it — see
   * `launcher/open-command.ts`, which resolves the difference in the one
   * process that can.
   */
  FileOpened: (path: string) => ({
    kind: WindowActionKind.FileOpened as const,
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
   * A key ran the command handed over with this. See
   * {@link WindowState.pressed}.
   */
  KeyPressed: () => ({ kind: WindowActionKind.KeyPressed as const }),

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

  /**
   * A key entered a binding mode — `mode resize`, and the `mode default` that
   * leaves it — on whichever page heard it.
   */
  ModeSet: (mode: string) => ({
    kind: WindowActionKind.ModeSet as const,
    mode,
  }),

  /** `focus mode_toggle`: between the floating windows and the tiled ones. */
  ModeSwapped: () => ({ kind: WindowActionKind.ModeSwapped as const }),

  /** `focus parent`. */
  ParentFocused: () => ({ kind: WindowActionKind.ParentFocused as const }),

  /** A client opened a popup over one of its windows, or moved one. */
  PopupPlaced: (popup: Popup) => ({
    kind: WindowActionKind.PopupPlaced as const,
    popup,
  }),

  /**
   * An extension asked for a window of its own — `chrome.windows.create` with
   * a popup — and the browser window the user was in passed it on.
   */
  PopupWindowOpened: (request: PopupWindowRequest) => ({
    kind: WindowActionKind.PopupWindowOpened as const,
    request,
  }),

  /** `scratchpad show`. */
  ScratchpadShown: () => ({ kind: WindowActionKind.ScratchpadShown as const }),

  /**
   * The pointer moved on a screen, which is what puts the keyboard there:
   * focus follows the cursor from one monitor to the next, whether or not
   * there is a window under it — see {@link WindowAction.WindowHovered} for
   * the window it is over.
   */
  ScreenHovered: (name: string) => ({
    kind: WindowActionKind.ScreenHovered as const,
    name,
  }),

  /**
   * The host described the desk: these screens, in this order.
   *
   * The desk is hardware and the workspaces are the user's work, so this only
   * ever says where the work can be seen. A screen that was already there
   * keeps what it was showing, a monitor that replaced one takes over what it
   * was showing, and a monitor that is new to the desk gets a workspace
   * nobody else is on.
   */
  ScreensDescribed: (screens: readonly PlacedScreen[]) => ({
    kind: WindowActionKind.ScreensDescribed as const,
    screens,
  }),

  /** `layout toggle split`. */
  SplitToggled: () => ({ kind: WindowActionKind.SplitToggled as const }),

  /**
   * The user asked for a terminal, which the compositor spawns.
   *
   * Nothing in the state moves: the window arrives as an announcement from
   * the host like any other client's. It is an action so that every command
   * a key can send is one of them.
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
   * The user let go of a tiled window they were dragging over another: onto
   * `target`'s `edge`, or its middle where that is `undefined`.
   *
   * Beside {@link WindowAction.WindowDropped} rather than instead of it: that
   * one ends the drag, whether or not it ended over anything.
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
   * user is working in: focus follows the cursor here. A hidden tab is its
   * container's open tab — see `pointedOn`.
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

  /**
   * The user dragged a floating window to a new corner of the desktop: `x`,
   * `y` in the page's pixels, which are the desk's — see `floatDragged`.
   */
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

  /**
   * The user dragged a floating window's corner to a new size — and, from the
   * top or the left, to a new place.
   */
  WindowResized: (id: string, box: Rect) => ({
    box,
    id,
    kind: WindowActionKind.WindowResized as const,
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

  /**
   * The user dragged a tiled window's `edge` `by` pixels, rightwards or
   * downwards where positive.
   *
   * With the box the workspace is laid out in, which only the monitor
   * showing it knows: the tree holds shares rather than lengths, and what a
   * pixel is a share of is a question about the screen.
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
): WindowState => rehomed(limited(state, reduceAction(state, action)));

const reduceAction = (
  state: WindowState,
  action: WindowAction,
): WindowState => {
  switch (action.kind) {
    case WindowActionKind.AppAppeared: {
      return openApp(state, action.appId, action.title);
    }
    case WindowActionKind.AppClosed: {
      // A popup, or a window: the ids are one space, and a popup's is never
      // a window's.
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
    case WindowActionKind.AppLaunched:
    case WindowActionKind.FileOpened: {
      // The compositor spawns it and the host announces the window it opens,
      // the same way a terminal's arrives. The panel goes, because the panel
      // is how the file or application was asked for.
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
    case WindowActionKind.PopupWindowOpened: {
      return openPopupWindow(state, action.request);
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
    case WindowActionKind.WindowDroppedOn: {
      return onWorkspaceWith(state, action.id, (workspace) =>
        tiledDropped(workspace, action.id, action.target, action.edge),
      );
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
      return floatDragged(state, action.id, action.x, action.y);
    }
    case WindowActionKind.WindowRenamed: {
      return renameWindow(state, action.id, action.title);
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
      return onCurrent(state, (workspace) =>
        windowMoved(workspace, action.direction),
      );
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

// The workspace on screen, put through `into`. Most of the keyed commands are
// exactly this: they act on what the user is looking at.
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

/**
 * `focus <direction>`: through the workspace on screen, and on to the screen
 * that way once there is nowhere left to go on this one — before wrapping
 * round, which is sway's order. A screen with nothing on it is still a screen
 * to go to: it is where the next window opens.
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

// The launcher shuts here as well as on `FileOpened` and `AppLaunched`,
// because those are the answers it has and a panel left up over its own
// answer is one the user has to dismiss after every URL they type. Harmless on the bar's `+`,
// where it is already shut.
const openBrowser = (state: WindowState, src: string): WindowState => {
  const browsersOpened = state.browsersOpened + 1;
  return openWindow(
    { ...state, browsersOpened, launcherOpen: false },
    Window.Browser(browsersOpened, src),
  );
};

// An extension's window floats, where every other window opening tiles: it is
// a dialog the extension sized for its own page, and a tile is whatever the
// layout has left, which is no size that page was drawn for. sway floats a client's dialog for the same reason.
// The launcher is left as it is: nothing in it asked.
const openPopupWindow = (
  state: WindowState,
  request: PopupWindowRequest,
): WindowState => {
  const browsersOpened = state.browsersOpened + 1;
  const window = Window.PopupWindow(browsersOpened, request);
  return onCurrent(
    { ...state, browsersOpened, windows: [...state.windows, window] },
    (workspace) =>
      openedFloating(
        workspace,
        window.id,
        screenHere(state),
        request.width,
        request.height,
      ),
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
    const shown = showWorkspace(state, workspace.name);
    if (found === workspace && shown === state) {
      // A reach that moved nothing gives back the state it was given, object
      // and all — which is what `AppWindow` says it relies on for the press
      // it reports in the window the user is already in. Rebuilt anyway, the
      // desktop re-renders on every click in the window being worked in.
      //
      // Only a tiled window comes back the same, because only the tiling has
      // a focus that can already be where it is being put: a float is raised
      // as well as focused, and a raise is a new order of the stack. And only
      // a window on the screen the keyboard is already on — reaching one on
      // another monitor takes the keyboard there, which is a desktop that
      // changed.
      return state;
    } else {
      return onWorkspace(shown, workspace.name, () => found);
    }
  }
};

/**
 * The workspace `name` in view with the keyboard in it.
 *
 * **TWO ANSWERS, AND WHICH ONE IT IS, IS WHETHER A SCREEN ALREADY HAS IT.**
 * Work the user can already see is reached by moving the keyboard to the
 * screen showing it, which is sway's answer and the only one that keeps a
 * workspace in one place: taking it here would leave the monitor it came from
 * showing nothing and put two screens on one workspace. Work nobody is
 * showing goes back on its own screen — see {@link WindowState.homes} — and
 * the keyboard with it; a workspace with no screen comes to the keyboard's.
 */
const showWorkspace = (state: WindowState, name: string): WindowState => {
  const shown = screenShowing(state, name);
  const home = state.homes[name] ?? state.focused;
  if (shown === state.focused) {
    // Already in view with the keyboard in it, which is every reach into the
    // window the user is already working in. The state it was given, object
    // and all: `reachWindow` hands that straight back, and `AppWindow` says
    // in as many words that it relies on it.
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

// The window under the pointer is the window the keyboard is in, which is the
// whole of this shell's focus policy — and a float the pointer crosses into
// comes to the front, as a click would bring it. Here rather than left to the
// compositor: a client's window used to come up only because the focus this
// moves came back from the host as a reach, and a browser window, which names
// no client, never did.
const pointAtWindow = (state: WindowState, id: string): WindowState => {
  // THE WINDOW'S OWN SCREEN, NOT THE ONE THE KEYBOARD IS ON. A pointer that
  // crossed onto another monitor's window takes the keys with it, which is the
  // whole of how a desk of several is worked. A window on a workspace no
  // screen is showing is not one a pointer can be over: it has no box to
  // point at, and reaching it would be a focus on something the user cannot
  // see.
  const workspace = workspaceHolding(state, id);
  const screen =
    workspace === undefined ? undefined : screenShowing(state, workspace.name);
  if (workspace === undefined || screen === undefined) {
    return state;
  } else {
    return pointAtShown(state, workspace, screen, pointedOn(workspace, id));
  }
};

// The pointer arriving in `id`, which is showing on `screen`.
const pointAtShown = (
  state: WindowState,
  workspace: Workspace,
  screen: string,
  id: string,
): WindowState =>
  // The same object for a pointer that never left: a window says this again
  // for every part of it that is an element of its own — a browser window's
  // address bar, its page — and none of those is the user reaching anywhere.
  focusedOn(workspace) === id && state.focused === screen
    ? state
    : onWorkspace({ ...state, focused: screen }, workspace.name, (found) =>
        reached(found, id),
      );

// The screen under the pointer is the screen the keyboard is on. The same
// object for a screen that already has it, because this is said on every move
// of the hand; and for one the desk has not taken up yet, which is a monitor
// plugged in that the pointer reached before the desk was told of it.
const pointAtScreen = (state: WindowState, name: string): WindowState =>
  state.focused === name ||
  !state.screens.some((screen) => screen.name === name)
    ? state
    : { ...state, focused: name };

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
/**
 * The desk the host described: one screen per display, in its order.
 *
 * **THE WORK STAYS WHERE IT WAS, WHICH IS WHAT MAKES A HOTPLUG SURVIVABLE.**
 * Every plug and unplug re-describes the whole desk, so this runs constantly
 * and almost always has nothing to change: a screen that was already there
 * goes on showing what it was showing. A display that is new takes over from
 * a screen that has just gone — a dock swapped for another names every
 * monitor differently, and the user's work is not the dock's to move — and
 * failing that shows the lowest-numbered workspace nobody else is on. Two
 * screens never show one workspace: a workspace drawn twice is a window
 * embedded twice, and the second embedding takes the first's pixels.
 *
 * A desk of no screens keeps one screen nobody has named, for the reason
 * {@link UNDESCRIBED_SCREEN} gives: the windows are still open and there is
 * nowhere to draw them, which is a different thing from there being no
 * windows.
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
  // The screens that are not in the new desk, in order: what a display new to
  // the desk takes over from. Read before anything is placed, because a name
  // that is in both is not a screen anybody replaces.
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

/** What one screen of a freshly described desk shows. */
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
    // More monitors than workspaces, which is ten of them. Nothing is a
    // better answer than a screen showing what another screen shows, and a
    // shell that threw here would take the desk down for owning a monitor
    // too many -- so the desk is the ten it can draw and this screen shows
    // the last of them.
    throw new Error(`shell: no workspace left for screen ${name}`);
  } else {
    return free;
  }
};

/** The screen the keyboard is on, once the desk is these screens. */
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
 * A floating window dragged to `x`, `y` in the page's pixels, and handed to
 * the screen its middle is now over — sway's `floating_fix_coordinates`.
 *
 * One page spans the desk, so the page's pixels are the desk's and a screen's
 * box is where it is on the page. A float is in the pixels of the screen
 * showing its workspace, and that screen's box is what converts.
 *
 * A middle over no screen at all — the gap an L of monitors leaves — keeps
 * the screen it has.
 *
 * A window on a workspace no screen is showing is not one a pointer can have
 * hold of, so a move that names one — a drag the keyboard switched the
 * workspace out from under — moves nothing.
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
      // The keyboard comes too: the pointer is already over there, and the
      // window the user has hold of is the one they are working in.
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

/** Where the screen `name` is on the desk. */
const boxOf = (state: WindowState, name: string): Rect => {
  const screen = state.screens.find((found) => found.name === name);
  if (screen === undefined) {
    throw new Error(`shell: no screen ${name}`);
  } else {
    return screen.box;
  }
};

/** The box the window `id` floats in. Throws for a window that is tiled. */
const floatHeld = (workspace: Workspace, id: string): Float => {
  const float = floatOn(workspace, id);
  if (float === undefined) {
    throw new Error(`shell: window ${id} is not floating`);
  } else {
    return float;
  }
};

/** The middle of a float on the screen at `box`, in the desk's pixels. */
const middleOf = (float: Float, box: Rect): readonly [number, number] => [
  box.x + float.x + float.width / 2,
  box.y + float.y + float.height / 2,
];

/**
 * The screen at `point`, or `undefined` off every one. Left and top edges and
 * not right and bottom, as `screenUnder`, so the column two screens share is
 * the one that starts there.
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

// `move container to workspace <name>`: the window goes and the user stays,
// which is sway's default. It lands tiled there however it was laid out here.
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
 * The state with {@link WindowState.homes} brought up to date with what the
 * reduction did to the screens and the workspaces — the same object when
 * nothing moved, which the reductions that hand back their own state rely on.
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

/** The screen `workspace` belongs to now, or `undefined` for none. */
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
 * `after`, with every floating window held to what its client will draw —
 * see `limitedTo`. After every action rather than in each that moves a float,
 * because a client can say its limits after it was floated, and every way a
 * float is sized would otherwise have to remember to ask.
 *
 * A window alone in its box only: a floating group's box is shared out among
 * its windows, so no one client's limits are the box's.
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

/** Where the float `id` was before the action, if it was floating then. */
const floatBefore = (state: WindowState, id: string) =>
  state.workspaces
    .flatMap(({ floats }) => floats)
    .find((float) => floatHolds(float, id));
