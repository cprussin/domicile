// Every change the shell's window list can undergo, as one pure reduction.
//
// The shell owns two things: which windows exist and which one has the stage.
// Both move together — a window that opens takes the stage, a window that
// closes hands it back — so they are one state, reduced in one place, with no
// DOM or bridge in sight. `useShellWindows` is what feeds host events into it.

import type { DropPosition } from "@domicile/component-library/TabRail";

import type { Float } from "./float";
import { floatFor, movedTo, sizedTo } from "./float";
import type { ShellWindow } from "./shell-window";
import { appWindowId, ShellWindow as Window } from "./shell-window";

export type ShellState = {
  /**
   * The window the user is working in, floating or not.
   *
   * Not the same as `shownId`, which names the *tabbed* window the stage is
   * showing. A floating window is on screen without being on the stage, so
   * once one is in front there are two questions to answer and one answer
   * cannot serve both: the rail highlights this, the stage shows that, and
   * this is what the keyboard follows.
   */
  activeId: string | undefined;
  /** How many browser windows have been opened, ever — the id counter. */
  browsersOpened: number;
  /**
   * The floating window the user has hold of, or `undefined` when none is.
   *
   * Here rather than in the component that reads the pointer because it is
   * what makes the window see-through while it moves, and because a drag
   * outlives the modifier that started it: letting go of Alt half way through
   * one must not drop the window.
   */
  draggingId: string | undefined;
  /**
   * The windows that have left the rail, back to front.
   *
   * The order is the stacking order, so raising a window is moving it to the
   * end — and its index is what the shell writes as `z-index`, which is what
   * the compositor stacks the client's own surface by.
   */
  floats: readonly Float[];
  /**
   * The app that holds the keyboard, or `undefined` when the chrome does.
   *
   * Not the same as `shownId`: the stage says which window the shell is
   * *showing*, and this says which one the compositor is *typing into*. They
   * agree while the shell is the only thing moving focus, and part company the
   * moment a click does — which is what this exists to follow.
   */
  focusedId: string | undefined;
  /**
   * The tabbed window on the stage, or `undefined` when none is.
   *
   * Never a floating window: a float is drawn over the stage rather than on
   * it, and the stage going blank because the user floated what was on it
   * would hide every other window they have open.
   */
  shownId: string | undefined;
  windows: readonly ShellWindow[];
};

/** A shell with nothing open: what the chrome starts from. */
export const EMPTY_SHELL: ShellState = {
  activeId: undefined,
  browsersOpened: 0,
  draggingId: undefined,
  floats: [],
  focusedId: undefined,
  shownId: undefined,
  windows: [],
};

/** A floating window's box and where it sits in the stack. */
export type Floating = {
  /**
   * Its place in the float order, which is what the shell writes as the
   * element's own `z-index`.
   */
  depth: number;
  float: Float;
};

/**
 * How the window `id` floats, or `undefined` when it is still in the rail.
 *
 * Takes the list rather than the whole state so that a component reading it
 * depends on the floats alone — every other field moves for reasons that do
 * not change where a window sits.
 */
export const floatingOf = (
  floats: readonly Float[],
  id: string,
): Floating | undefined => {
  const depth = floats.findIndex((float) => float.id === id);
  // Indexed rather than `.at`, which reads -1 as the last entry — so a window
  // that is not floating at all would come back floating on top.
  const float = floats[depth];
  return float === undefined ? undefined : { depth, float };
};

/** The box the window `id` floats in, or `undefined` when it is tabbed. */
const floatOf = (state: ShellState, id: string): Float | undefined =>
  state.floats.find((float) => float.id === id);

export enum ShellActionKind {
  AppAppeared,
  AppClosed,
  AppTitled,
  BrowserOpened,
  FocusChanged,
  WindowClosed,
  WindowDropped,
  WindowFloated,
  WindowGrabbed,
  WindowMoved,
  WindowRaised,
  WindowRenamed,
  WindowResized,
  WindowSelected,
  WindowTabbed,
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

  /** The user let go of the window they had hold of. */
  WindowDropped: () => ({
    kind: ShellActionKind.WindowDropped as const,
  }),

  /** The user took a window out of the rail to float over the stage. */
  WindowFloated: (id: string) => ({
    id,
    kind: ShellActionKind.WindowFloated as const,
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
    kind: ShellActionKind.WindowGrabbed as const,
  }),

  /** The user dragged a floating window to a new corner of the stage. */
  WindowMoved: (id: string, x: number, y: number) => ({
    id,
    kind: ShellActionKind.WindowMoved as const,
    x,
    y,
  }),

  /** The user touched a floating window, which brings it to the front. */
  WindowRaised: (id: string) => ({
    id,
    kind: ShellActionKind.WindowRaised as const,
  }),

  /** A browser window's page navigated, so its tab says somewhere new. */
  WindowRenamed: (id: string, title: string) => ({
    id,
    kind: ShellActionKind.WindowRenamed as const,
    title,
  }),

  /** The user dragged a floating window's corner to a new size. */
  WindowResized: (id: string, width: number, height: number) => ({
    height,
    id,
    kind: ShellActionKind.WindowResized as const,
    width,
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

  /** The user put a floating window back on the stage. */
  WindowTabbed: (id: string) => ({
    id,
    kind: ShellActionKind.WindowTabbed as const,
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
      return focusedId === state.focusedId
        ? state
        : followFocus({ ...state, focusedId }, focusedId);
    }
    case ShellActionKind.WindowClosed: {
      return closeWindow(state, action.id);
    }
    case ShellActionKind.WindowDropped: {
      return { ...state, draggingId: undefined };
    }
    case ShellActionKind.WindowFloated: {
      return floatWindow(state, action.id);
    }
    case ShellActionKind.WindowGrabbed: {
      // Taking hold of a window brings it to the front, the same way clicking
      // one does — which is what a grab is.
      return { ...raiseWindow(state, action.id), draggingId: action.id };
    }
    case ShellActionKind.WindowMoved: {
      return reshape(state, action.id, (float) =>
        movedTo(float, action.x, action.y),
      );
    }
    case ShellActionKind.WindowRaised: {
      return raiseWindow(state, action.id);
    }
    case ShellActionKind.WindowRenamed: {
      return renameWindow(state, action.id, action.title);
    }
    case ShellActionKind.WindowResized: {
      return reshape(state, action.id, (float) =>
        sizedTo(float, action.width, action.height),
      );
    }
    case ShellActionKind.WindowSelected: {
      return showWindow(state, action.id);
    }
    case ShellActionKind.WindowTabbed: {
      return tabWindow(state, action.id);
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

// The compositor moving the keyboard onto a window is the user working in it,
// so the shell follows. Clicking is the only way to reach a floating window
// whose tab is not the selected one, and without this the rail would go on
// highlighting whatever the user had left — and Alt+Tab, which acts on the
// window they are working in, would float the wrong one.
//
// Focus that landed on the chrome, or on a window the shell has not been told
// about yet, leaves the active window where it was: there is nothing better to
// point at, and `undefined` would be worse than stale.
const followFocus = (
  state: ShellState,
  focusedId: string | undefined,
): ShellState => {
  if (
    focusedId === undefined ||
    !state.windows.some((window) => window.id === focusedId)
  ) {
    return state;
  } else if (floatOf(state, focusedId) === undefined) {
    return { ...state, activeId: focusedId };
  } else {
    // Clicked under another float, so it comes to the front as well.
    return raiseWindow(state, focusedId);
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

// A window that opens takes the stage; whatever had it is a tab away. It
// opens tabbed, so it is also the window the user is now working in.
const openWindow = (state: ShellState, window: ShellWindow): ShellState => ({
  ...state,
  activeId: window.id,
  shownId: window.id,
  windows: [...state.windows, window],
});

// The window the stage falls back to: the most recently opened of the ones
// still in the rail. A floating window is on screen already and putting it on
// the stage as well would draw it twice.
const lastTabbed = (
  windows: readonly ShellWindow[],
  floats: readonly Float[],
): string | undefined =>
  windows
    .filter((window) => !floats.some((float) => float.id === window.id))
    .at(-1)?.id;

// Out of the rail and over the stage. Floating one twice is not an error and
// not a second box either: the user asking again for what they already have
// is the same window, and re-cascading it would move a window they had put
// somewhere on purpose.
const floatWindow = (state: ShellState, id: string): ShellState => {
  if (!state.windows.some((window) => window.id === id)) {
    throw new Error(`shell: no window ${id} to float`);
  } else if (floatOf(state, id) === undefined) {
    const floats = [...state.floats, floatFor(id, state.floats.length)];
    return {
      ...state,
      activeId: id,
      floats,
      // The stage keeps whatever it had unless this window was it, in which
      // case it falls back the same way a close does.
      shownId:
        state.shownId === id
          ? lastTabbed(state.windows, floats)
          : state.shownId,
    };
  } else {
    return state;
  }
};

// And back into the rail, onto the stage, which is where a window that is no
// longer floating has to go: the alternative is a window with no box and no
// tab selected, which is a window the user has lost.
const tabWindow = (state: ShellState, id: string): ShellState => {
  if (floatOf(state, id) === undefined) {
    throw new Error(`shell: window ${id} is not floating`);
  } else {
    return {
      ...state,
      activeId: id,
      // Whatever the pointer was doing, it was doing it to a window that is
      // now on the stage and has no box to drag.
      draggingId: state.draggingId === id ? undefined : state.draggingId,
      floats: state.floats.filter((float) => float.id !== id),
      shownId: id,
    };
  }
};

// A floating window's box, replaced. Only a floating window has one, so
// asking to reshape a tabbed one is a wiring fault rather than a no-op: the
// caller is dragging something the shell is not laying out.
const reshape = (
  state: ShellState,
  id: string,
  into: (float: Float) => Float,
): ShellState => {
  if (floatOf(state, id) === undefined) {
    throw new Error(`shell: window ${id} is not floating`);
  } else {
    return {
      ...state,
      floats: state.floats.map((float) =>
        float.id === id ? into(float) : float,
      ),
    };
  }
};

// To the front, which is the end of the list: the order is the stacking order.
const raiseWindow = (state: ShellState, id: string): ShellState => {
  const raised = floatOf(state, id);
  if (raised === undefined) {
    throw new Error(`shell: window ${id} is not floating`);
  } else {
    return {
      ...state,
      activeId: id,
      floats: [...state.floats.filter((float) => float.id !== id), raised],
    };
  }
};

// The stage goes to the most recently opened of the survivors, so closing a
// window lands on the one the user was on before it. A close for a window the
// shell never opened is the host draining events for a portal already torn
// down, which leaves the list as it is.
const closeWindow = (state: ShellState, id: string): ShellState => {
  const windows = state.windows.filter((window) => window.id !== id);
  const floats = state.floats.filter((float) => float.id !== id);
  const shownId =
    state.shownId === id ? lastTabbed(windows, floats) : state.shownId;
  return {
    ...state,
    // The topmost float first, because closing the front window puts the user
    // on the one it was covering; the stage is what is left when none is out.
    activeId:
      state.activeId === id ? (floats.at(-1)?.id ?? shownId) : state.activeId,
    draggingId: state.draggingId === id ? undefined : state.draggingId,
    floats,
    shownId,
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

// A tab is a way to reach a window, and a floating window still has one. What
// reaching it means differs: a tabbed window goes on the stage, and a floating
// one is on screen already, so it comes to the front instead. Putting it back
// on the stage would undo the float the user asked for by clicking its tab.
const showWindow = (state: ShellState, id: string): ShellState => {
  if (!state.windows.some((window) => window.id === id)) {
    throw new Error(`shell: no window ${id} to show`);
  } else if (floatOf(state, id) === undefined) {
    return { ...state, activeId: id, shownId: id };
  } else {
    return raiseWindow(state, id);
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
