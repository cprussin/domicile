import { describe, expect, it } from "bun:test";

import { Axis, Direction } from "./direction";
import { Layout } from "./tree/node";
import { windowsOf } from "./tree/tiling";
import { appWindowId } from "./window";
import type { WindowState } from "./window-state";
import {
  activeIdOf,
  BindingMode,
  NO_WINDOWS,
  reduceWindows,
  WindowAction,
  workspaceNamed,
  workspaceOn,
} from "./window-state";
import { windowsOn } from "./workspace";

const reduce = (
  state: WindowState,
  ...actions: readonly WindowAction[]
): WindowState => actions.reduce(reduceWindows, state);

/** A desktop with these clients open on workspace 1. */
const desktop = (...appIds: readonly string[]): WindowState =>
  reduce(
    NO_WINDOWS,
    ...appIds.map((appId) => WindowAction.AppAppeared(appId, appId)),
  );

const APP = appWindowId;

describe("the windows a host announces", () => {
  it("opens a window for each client, tiled on the workspace on screen", () => {
    const state = desktop("kitty", "editor");

    expect(windowsOn(workspaceOn(state))).toEqual([
      APP("kitty"),
      APP("editor"),
    ]);
    expect(activeIdOf(state)).toBe(APP("editor"));
  });

  it("takes the window away when the client goes", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.AppClosed("editor"),
    );

    expect(state.windows.map(({ id }) => id)).toEqual([APP("kitty")]);
    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("re-announces a client it already has a window for as the same window", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.AppAppeared("kitty", "kitty"),
    );

    expect(state.windows).toHaveLength(1);
  });

  it("names the window whatever the client last called it", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.AppTitled("kitty", "vim ~/notes"),
    );

    expect(state.windows[0]).toMatchObject({ title: "vim ~/notes" });
  });

  it("grants a client asking for the keyboard, on the workspace it is on", () => {
    // A client asking over xdg-activation, which the compositor forwards
    // without granting: manganese grants it and goes to where the window is.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.FocusRequested("kitty"),
    );

    expect(state.current).toBe("1");
    expect(activeIdOf(state)).toBe(APP("kitty"));
  });
});

describe("the browser windows the shell opens itself", () => {
  it("opens one on the workspace on screen and works in it", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.BrowserOpened("https://example.com"),
    );

    expect(activeIdOf(state)).toBe("browser:1");
    expect(state.windows[1]).toMatchObject({ title: "example.com" });
  });

  it("closes one itself, because the shell owns it", () => {
    const state = reduce(
      desktop(),
      WindowAction.BrowserOpened("https://example.com"),
      WindowAction.WindowKilled(),
    );

    expect(state.windows).toEqual([]);
  });

  it("leaves a client's window for the client to close", () => {
    // `closeApp` is a request: an editor with unsaved work may put a dialog
    // up and stay, so the window goes when the host says it went.
    const state = reduce(desktop("editor"), WindowAction.WindowKilled());

    expect(state.windows).toHaveLength(1);
  });
});

describe("the workspaces", () => {
  it("starts on the first one", () => {
    expect(NO_WINDOWS.current).toBe("1");
  });

  it("switches to the one the key names", () => {
    const state = reduce(desktop("kitty"), WindowAction.WorkspaceSelected("3"));

    expect(state.current).toBe("3");
    expect(activeIdOf(state)).toBeUndefined();
  });

  it("goes back to the last one when the key names the one on screen", () => {
    // `workspaceAutoBackAndForth = true`.
    const state = reduce(
      desktop("kitty"),
      WindowAction.WorkspaceSelected("3"),
      WindowAction.WorkspaceSelected("3"),
    );

    expect(state.current).toBe("1");
  });

  it("sends the window being worked in to another workspace, and stays", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToWorkspace("2"),
    );

    expect(state.current).toBe("1");
    expect(windowsOn(workspaceOn(state))).toEqual([APP("kitty")]);
    expect(windowsOn(workspaceNamed(state, "2"))).toEqual([APP("editor")]);
    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("keeps a window that closes on a workspace nobody is looking at", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToWorkspace("2"),
      WindowAction.AppClosed("editor"),
    );

    expect(windowsOn(workspaceNamed(state, "2"))).toEqual([]);
    expect(state.windows.map(({ id }) => id)).toEqual([APP("kitty")]);
  });
});

describe("the scratchpad", () => {
  it("takes the window being worked in off the desktop", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToScratchpad(),
    );

    expect(windowsOn(workspaceOn(state))).toEqual([APP("kitty")]);
    expect(state.scratchpad).toEqual([APP("editor")]);
    expect(state.windows).toHaveLength(2);
  });

  it("shows it again, floating over whatever workspace is on screen", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToScratchpad(),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.ScratchpadShown(),
    );

    expect(state.scratchpad).toEqual([]);
    expect(workspaceOn(state).floats.map(({ id }) => id)).toEqual([
      APP("editor"),
    ]);
    expect(activeIdOf(state)).toBe(APP("editor"));
  });

  it("hides the one it is showing rather than fetching another", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToScratchpad(),
      WindowAction.ScratchpadShown(),
      WindowAction.ScratchpadShown(),
    );

    expect(state.scratchpad).toEqual([APP("editor")]);
    expect(workspaceOn(state).floats).toEqual([]);
  });

  it("has nothing to show on an empty scratchpad", () => {
    const state = desktop("kitty");

    expect(reduceWindows(state, WindowAction.ScratchpadShown())).toBe(state);
  });

  it("takes a window out of the scratchpad when its client goes", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToScratchpad(),
      WindowAction.AppClosed("editor"),
    );

    expect(state.scratchpad).toEqual([]);
    expect(state.windows).toHaveLength(1);
  });
});

describe("the keyed commands", () => {
  it("passes the tiling commands to the workspace on screen", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FocusStepped(Direction.Left),
    );

    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("moves a window through the tiling", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowStepped(Direction.Left),
    );

    expect(windowsOf(workspaceOn(state).tiling)).toEqual([
      APP("editor"),
      APP("kitty"),
    ]);
  });

  it("rearranges and splits the container the focus is in", () => {
    const tabbed = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.Tabbed),
    );
    expect(workspaceOn(tabbed).tiling.root).toMatchObject({
      layout: Layout.Tabbed,
    });

    const split = reduce(
      desktop("kitty"),
      WindowAction.ContainerSplit(Axis.Vertical),
    );
    expect(workspaceOn(split).tiling.root).toMatchObject({
      layout: Layout.SplitV,
    });
  });

  it("floats the window being worked in, and puts it back", () => {
    const floated = reduce(
      desktop("kitty", "editor"),
      WindowAction.FloatToggled(),
    );
    expect(workspaceOn(floated).floats.map(({ id }) => id)).toEqual([
      APP("editor"),
    ]);

    const tiled = reduce(floated, WindowAction.FloatToggled());
    expect(workspaceOn(tiled).floats).toEqual([]);
  });

  it("fills the screen with the window being worked in", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.FullscreenToggled(false),
    );

    expect(workspaceOn(state).fullscreen).toEqual({
      global: false,
      id: APP("kitty"),
    });
  });

  it("changes the mode the keys are read in", () => {
    const state = reduce(desktop(), WindowAction.ModeSet(BindingMode.Resize));

    expect(state.mode).toBe(BindingMode.Resize);
  });

  it("leaves the state alone for a terminal, which is the compositor's to spawn", () => {
    const state = desktop("kitty");

    expect(reduceWindows(state, WindowAction.TerminalLaunched())).toBe(state);
  });
});

describe("what the compositor says about the keyboard", () => {
  it("follows the seat onto the window it names", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FocusChanged("kitty"),
    );

    expect(state.focusedId).toBe(APP("kitty"));
    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("leaves the window being worked in alone when the chrome takes it", () => {
    // Pressing the top bar hands the keyboard back to the page, and the
    // window the user is working in has not changed.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FocusChanged(undefined),
    );

    expect(state.focusedId).toBeUndefined();
    expect(activeIdOf(state)).toBe(APP("editor"));
  });

  it("says nothing twice", () => {
    // The host tells a chrome that has just connected where the keyboard is,
    // which is usually what the shell already knew.
    const state = reduce(desktop("kitty"), WindowAction.FocusChanged("kitty"));

    expect(reduceWindows(state, WindowAction.FocusChanged("kitty"))).toBe(
      state,
    );
  });
});

describe("the pointer", () => {
  it("makes the window under it the one being worked in", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowHovered(APP("kitty")),
    );

    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("reports a window on another workspace as nothing at all", () => {
    // Which cannot happen from the page — an off-screen window has no box to
    // point at — and would be a focus on something the user cannot see.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToWorkspace("2"),
    );

    expect(
      reduceWindows(state, WindowAction.WindowHovered(APP("editor"))),
    ).toBe(state);
  });

  it("answers a press in the window it is already in with the same state", () => {
    // `AppWindow` reports every press a client's window takes, the ones that
    // move no focus included — focus follows the cursor, so that is most of
    // them — and leans on the reduction to make those cost nothing. An
    // object that came back different would re-render the desktop on every
    // click, and would run the focus chain back down to the window, which is
    // `focus parent` undone.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.ParentFocused(),
    );

    expect(
      reduceWindows(state, WindowAction.WindowSelected(APP("editor"))),
    ).toBe(state);
  });

  it("goes to the workspace of a window that asks to be reached", () => {
    // `xdg-activation`, which this shell grants: the window is already the
    // one its own workspace has the focus on, so reaching for it moves
    // nothing *there* — and going there is the whole of what granting it
    // means.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToWorkspace("2"),
    );

    expect(
      reduceWindows(state, WindowAction.FocusRequested("editor")).current,
    ).toBe("2");
  });

  it("raises and holds the window a drag takes hold of", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FloatToggled(),
      WindowAction.WindowGrabbed(APP("editor")),
    );

    expect(state.draggingId).toBe(APP("editor"));
    expect(
      reduceWindows(state, WindowAction.WindowDropped()).draggingId,
    ).toBeUndefined();
  });

  it("puts a dragged window where it was dropped", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.FloatToggled(),
      WindowAction.WindowMoved(APP("kitty"), 300, 200),
      WindowAction.WindowResized(APP("kitty"), 800, 600),
    );

    expect(workspaceOn(state).floats[0]).toMatchObject({
      height: 600,
      width: 800,
      x: 300,
      y: 200,
    });
  });
});

describe("the buttons on a window's own title bar", () => {
  it("fills the screen with the window whose bar it is, not the one being worked in", () => {
    // The bar is the window's, so pressing anything on it is reaching for that
    // window: the button fullscreens what it is drawn on rather than whatever
    // the keyboard happened to be in.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowFullscreened(APP("kitty")),
    );

    expect(workspaceOn(state).fullscreen).toEqual({
      global: false,
      id: APP("kitty"),
    });
    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("gives the screen back when the same button is pressed again", () => {
    // The same toggle `mod+f` is, because it is the same command.
    const state = reduce(
      desktop("kitty"),
      WindowAction.WindowFullscreened(APP("kitty")),
      WindowAction.WindowFullscreened(APP("kitty")),
    );

    expect(workspaceOn(state).fullscreen).toBeUndefined();
  });
});

describe("the clipboard panel", () => {
  it("is shut on a desktop nobody has opened it on", () => {
    expect(NO_WINDOWS.clipboardOpen).toBe(false);
  });

  it("opens and shuts on the same key", () => {
    // The launcher's rule, for the launcher's reason: the press that reaches
    // the panel is the press that gives up on it.
    const opened = reduce(NO_WINDOWS, WindowAction.ClipboardToggled());
    expect(opened.clipboardOpen).toBe(true);

    expect(reduce(opened, WindowAction.ClipboardToggled()).clipboardOpen).toBe(
      false,
    );
  });

  it("shuts when it is dismissed, however many times", () => {
    // Escape, a click on the backdrop, and a row chosen — the panel reports
    // its own closing on all three, so dismissing a shut one is a state
    // nobody should have to think about.
    const dismissed = reduce(
      NO_WINDOWS,
      WindowAction.ClipboardToggled(),
      WindowAction.ClipboardDismissed(),
      WindowAction.ClipboardDismissed(),
    );

    expect(dismissed.clipboardOpen).toBe(false);
  });
});

describe("the launcher", () => {
  it("is shut on a desktop nobody has opened it on", () => {
    expect(NO_WINDOWS.launcherOpen).toBe(false);
  });

  it("opens and shuts on the same key", () => {
    // One binding, because `mod+space` is what a person presses to *reach*
    // the launcher and pressing it again is the same reflex as Escape. Two
    // actions would be a key that only works one way round.
    const opened = reduce(NO_WINDOWS, WindowAction.LauncherToggled());
    expect(opened.launcherOpen).toBe(true);

    expect(reduce(opened, WindowAction.LauncherToggled()).launcherOpen).toBe(
      false,
    );
  });

  it("shuts when it is dismissed, however many times", () => {
    // Escape, and a click on the backdrop, both of which the dialog reports as
    // one thing. Idempotent because the dialog reports its own closing too:
    // dismissing a shut launcher is a state nobody should have to think about.
    const dismissed = reduce(
      NO_WINDOWS,
      WindowAction.LauncherToggled(),
      WindowAction.LauncherDismissed(),
      WindowAction.LauncherDismissed(),
    );

    expect(dismissed.launcherOpen).toBe(false);
  });

  it("shuts behind the browser window it opened", () => {
    // The panel is how the window was asked for; leaving it up over the answer
    // would mean typing a URL and then having to dismiss the thing you typed
    // it into. Nothing else has to remember to close it — the launch closes
    // it, on whichever of the two paths the query took.
    const launched = reduce(
      NO_WINDOWS,
      WindowAction.LauncherToggled(),
      WindowAction.BrowserOpened("https://example.com"),
    );

    expect(launched.launcherOpen).toBe(false);
    expect(launched.windows).toHaveLength(1);
  });

  it("shuts behind the editor it launched, and opens no window itself", () => {
    // The editor is a Wayland client the compositor spawns, so its window
    // arrives as an `app_appeared` like any other client's. Nothing here has a
    // window to add, which is the same shape `TerminalLaunched` has.
    const launched = reduce(
      NO_WINDOWS,
      WindowAction.LauncherToggled(),
      WindowAction.EditorLaunched("Notes/today.org"),
    );

    expect(launched.launcherOpen).toBe(false);
    expect(launched.windows).toStrictEqual([]);
  });
});
