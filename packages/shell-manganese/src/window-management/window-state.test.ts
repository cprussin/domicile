import { describe, expect, it } from "bun:test";

import { Axis, Direction } from "./direction";
import { Layout } from "./tree/node";
import { windowsOf } from "./tree/tiling";
import { appWindowId } from "./window";
import type { WindowState } from "./window-state";
import {
  activeIdOf,
  BindingMode,
  currentHere,
  currentOn,
  NO_WINDOWS,
  reduceWindows,
  WindowAction,
  workspaceHere,
  workspaceNamed,
  workspaceOn,
  workspacesOn,
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

    expect(windowsOn(workspaceHere(state))).toEqual([
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

    expect(currentHere(state)).toBe("1");
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

describe("the screens", () => {
  it("is one screen nobody has named until the host describes a desk", () => {
    // A window can open before the handshake is answered, so there is always
    // somewhere for one to be. No display is called "", so nothing is drawn
    // on this screen -- it is where the desktop is while nobody can see it.
    expect(NO_WINDOWS.screens).toEqual([{ current: "1", name: "" }]);
    expect(NO_WINDOWS.focused).toBe("");
  });

  it("gives the first named screen what the unnamed one was showing", () => {
    // The handshake's worth of desktop. A window that opened before the desk
    // was described is on a workspace, and that workspace is what the screen
    // it is finally drawn on shows -- otherwise the first frame of a desk is
    // a window that has already been lost.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(["left", "right"]),
    );

    expect(currentOn(state, "left")).toBe("1");
    expect(state.focused).toBe("left");
    expect(windowsOn(workspaceOn(state, "left"))).toEqual([APP("kitty")]);
  });

  it("shows a workspace nobody else is on when a monitor is plugged in", () => {
    // A SCREEN IS A WORKSPACE THE USER CAN SEE, and two screens showing one
    // workspace would be one workspace drawn twice -- which is one window
    // embedded twice, and the second embedding takes the first's pixels.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(["left"]),
      WindowAction.ScreensDescribed(["left", "right"]),
    );

    expect(currentOn(state, "left")).toBe("1");
    expect(currentOn(state, "right")).toBe("2");
  });

  it("leaves a screen that was already there showing what it was", () => {
    // Every hotplug re-describes the whole desk, and a monitor that had
    // nothing to do with it must not have its workspace taken away.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(["left", "right"]),
      WindowAction.WorkspaceSelected("5"),
      WindowAction.ScreensDescribed(["left", "right", "third"]),
    );

    expect(currentOn(state, "left")).toBe("5");
    expect(currentOn(state, "right")).toBe("2");
  });

  it("hands a swapped monitor what the one it replaced was showing", () => {
    // A dock changed and every name is new. The workspaces are the user's
    // work and the screens are hardware, so the work stays where it was
    // rather than every monitor coming back on workspace 1.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(["left", "right"]),
      // To the right-hand monitor, and then to some workspace on it.
      WindowAction.WorkspaceSelected("2"),
      WindowAction.WorkspaceSelected("7"),
      WindowAction.ScreensDescribed(["left", "docked"]),
    );

    expect(currentOn(state, "docked")).toBe("7");
    expect(currentOn(state, "left")).toBe("1");
  });

  it("moves the keyboard to the first screen when the one it was on goes", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(["left", "right"]),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.ScreensDescribed(["left"]),
    );

    expect(state.focused).toBe("left");
  });

  it("keeps the desktop on one unnamed screen when the last monitor goes", () => {
    // A lid shut on a laptop with nothing plugged in. The windows are still
    // open and still on their workspaces; there is nowhere to draw them, which
    // is a different thing and is what the empty name says.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(["left"]),
      WindowAction.ScreensDescribed([]),
    );

    expect(state.screens).toEqual([{ current: "1", name: "" }]);
    expect(windowsOn(workspaceOn(state, ""))).toEqual([APP("kitty")]);
  });
});

describe("the desktop another page of the desk reduced", () => {
  it("is taken whole, because that page is the one that has it", () => {
    // A desk of several monitors is several pages and one desktop: the page
    // covering the first screen reduces it and the others show what it says.
    // Whole rather than as what changed, so a page that came up late and a
    // page that has been listening all along take the same thing.
    const reduced = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(["left", "right"]),
      WindowAction.WorkspaceSelected("2"),
    );

    const shown = reduce(NO_WINDOWS, WindowAction.DeskAdopted(reduced));

    expect(shown).toEqual(reduced);
  });
});

describe("the workspaces", () => {
  it("starts on the first one", () => {
    expect(currentHere(NO_WINDOWS)).toBe("1");
  });

  it("switches to the one the key names", () => {
    const state = reduce(desktop("kitty"), WindowAction.WorkspaceSelected("3"));

    expect(currentHere(state)).toBe("3");
    expect(activeIdOf(state)).toBeUndefined();
  });

  it("goes back to the last one when the key names the one on screen", () => {
    // `workspaceAutoBackAndForth = true`.
    const state = reduce(
      desktop("kitty"),
      WindowAction.WorkspaceSelected("3"),
      WindowAction.WorkspaceSelected("3"),
    );

    expect(currentHere(state)).toBe("1");
  });

  it("moves the keyboard to the screen already showing the one named", () => {
    // sway's own answer, and the only one that keeps a workspace in one
    // place: the user asked for work they can already see, so what moves is
    // the keyboard rather than the workspace. Taking it here instead would
    // leave the monitor it came from showing nothing and put two screens on
    // one workspace.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(["left", "right"]),
      WindowAction.WorkspaceSelected("2"),
    );

    expect(state.focused).toBe("right");
    expect(currentOn(state, "left")).toBe("1");
    expect(currentOn(state, "right")).toBe("2");
  });

  it("shows a workspace nobody is showing on the screen the keyboard is on", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(["left", "right"]),
      WindowAction.WorkspaceSelected("9"),
    );

    expect(state.focused).toBe("left");
    expect(currentOn(state, "left")).toBe("9");
    expect(currentOn(state, "right")).toBe("2");
  });

  it("opens a window on the screen the keyboard is on", () => {
    // Windows per screen is the whole point of the desk having several. A
    // window that opened on the first screen whatever the user was looking at
    // is a desk of one monitor with two dark ones beside it.
    const state = reduce(
      desktop(),
      WindowAction.ScreensDescribed(["left", "right"]),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.AppAppeared("kitty", "kitty"),
    );

    expect(windowsOn(workspaceOn(state, "right"))).toEqual([APP("kitty")]);
    expect(windowsOn(workspaceOn(state, "left"))).toEqual([]);
  });

  it("sends the window being worked in to another workspace, and stays", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToWorkspace("2"),
    );

    expect(currentHere(state)).toBe("1");
    expect(windowsOn(workspaceHere(state))).toEqual([APP("kitty")]);
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

describe("the workspaces each screen has", () => {
  /**
   * Two monitors, with kitty on the left-hand one's workspace 1 and an editor
   * on workspace 2, which the right-hand one showed and has since left for 3.
   */
  const twoScreens = (): WindowState =>
    reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(["left", "right"]),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.AppAppeared("editor", "editor"),
      WindowAction.WorkspaceSelected("3"),
    );

  it("keeps a workspace on the screen it was last shown on", () => {
    // sway's: a workspace belongs to one output, and only that output's bar
    // lists it.
    const state = twoScreens();

    expect(workspacesOn(state, "left")).toEqual(["1"]);
    expect(workspacesOn(state, "right")).toEqual(["2", "3"]);
  });

  it("shows a hidden workspace on its own screen, and takes the keyboard there", () => {
    const state = reduce(
      twoScreens(),
      WindowAction.WorkspaceSelected("1"),
      WindowAction.WorkspaceSelected("2"),
    );

    expect(state.focused).toBe("right");
    expect(currentOn(state, "left")).toBe("1");
    expect(currentOn(state, "right")).toBe("2");
  });

  it("puts a window sent to an empty workspace on the screen it was sent from", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.ScreensDescribed(["left", "right"]),
      WindowAction.WindowSentToWorkspace("5"),
    );

    expect(workspacesOn(state, "left")).toEqual(["1", "5"]);
    expect(workspacesOn(state, "right")).toEqual(["2"]);
  });

  it("hands the workspaces of a monitor that goes to the screen the keyboard is on", () => {
    const state = reduce(
      twoScreens(),
      WindowAction.WorkspaceSelected("1"),
      WindowAction.ScreensDescribed(["left"]),
    );

    expect(workspacesOn(state, "left")).toEqual(["1", "2"]);
  });
});

describe("the scratchpad", () => {
  it("takes the window being worked in off the desktop", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToScratchpad(),
    );

    expect(windowsOn(workspaceHere(state))).toEqual([APP("kitty")]);
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
    expect(workspaceHere(state).floats.map(({ id }) => id)).toEqual([
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
    expect(workspaceHere(state).floats).toEqual([]);
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

    expect(windowsOf(workspaceHere(state).tiling)).toEqual([
      APP("editor"),
      APP("kitty"),
    ]);
  });

  it("rearranges and splits the container the focus is in", () => {
    const tabbed = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.Tabbed),
    );
    expect(workspaceHere(tabbed).tiling.root).toMatchObject({
      layout: Layout.Tabbed,
    });

    const split = reduce(
      desktop("kitty"),
      WindowAction.ContainerSplit(Axis.Vertical),
    );
    expect(workspaceHere(split).tiling.root).toMatchObject({
      layout: Layout.SplitV,
    });
  });

  it("floats the window being worked in, and puts it back", () => {
    const floated = reduce(
      desktop("kitty", "editor"),
      WindowAction.FloatToggled(),
    );
    expect(workspaceHere(floated).floats.map(({ id }) => id)).toEqual([
      APP("editor"),
    ]);

    const tiled = reduce(floated, WindowAction.FloatToggled());
    expect(workspaceHere(tiled).floats).toEqual([]);
  });

  it("fills the screen with the window being worked in", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.FullscreenToggled(false),
    );

    expect(workspaceHere(state).fullscreen).toEqual({
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
      currentHere(reduceWindows(state, WindowAction.FocusRequested("editor"))),
    ).toBe("2");
  });

  it("moves the keyboard to the screen the window it crossed is on", () => {
    // FOCUS FOLLOWS THE POINTER ACROSS MONITORS, which is the whole of how a
    // desk of several is worked: the hand moves to the other screen and the
    // keys follow it. Each screen is a page of its own drawing its own
    // windows, so the page that saw the pointer is the one that says this.
    const state = reduce(
      desktop(),
      WindowAction.ScreensDescribed(["left", "right"]),
      WindowAction.AppAppeared("kitty", "kitty"),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.AppAppeared("editor", "editor"),
      WindowAction.WindowHovered(APP("kitty")),
    );

    expect(state.focused).toBe("left");
    expect(activeIdOf(state)).toBe(APP("kitty"));
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

    expect(workspaceHere(state).floats[0]).toMatchObject({
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

    expect(workspaceHere(state).fullscreen).toEqual({
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

    expect(workspaceHere(state).fullscreen).toBeUndefined();
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
