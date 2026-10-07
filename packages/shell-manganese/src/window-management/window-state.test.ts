import { describe, expect, it } from "bun:test";

import { Axis, Direction } from "./direction";
import { TITLE_BAR } from "./rect";
import { Layout, windowsIn } from "./tree/node";
import { windowsOf } from "./tree/tiling";
import { appWindowId, browserWindowId } from "./window";
import type { WindowState } from "./window-state";
import {
  activeIdOf,
  currentHere,
  currentOn,
  NO_WINDOWS,
  reduceWindows,
  screenOfApp,
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
const BROWSER = browserWindowId;

/** A browser window as the engine lists it. */
const listed = (
  id: string,
  url: string,
  popup: { popupWindow: number; width: number; height: number } = {
    height: 0,
    popupWindow: 0,
    width: 0,
  },
) => ({
  height: popup.height,
  id,
  popupWindow: popup.popupWindow === 0 ? null : popup.popupWindow,
  title: "",
  url,
  width: popup.width,
});

/** Screens of 1920 by 1080, left to right in the order named. */
const sideBySide = (...names: readonly string[]) =>
  names.map((name, at) => ({
    box: { height: 1080, width: 1920, x: at * 1920, y: 0 },
    name,
  }));

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
    // The compositor forwards xdg-activation requests without granting them;
    // manganese grants them and switches to the window's workspace.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.FocusRequested("kitty"),
    );

    expect(currentHere(state)).toBe("1");
    expect(activeIdOf(state)).toBe(APP("kitty"));
  });
});

describe("the browser windows the engine lists", () => {
  it("opens one on the workspace on screen and works in it", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.BrowserWindowsListed([listed("1", "https://example.com/")]),
    );

    expect(activeIdOf(state)).toBe(BROWSER("1"));
    expect(state.windows[1]).toMatchObject({ title: "example.com" });
  });

  it("asks for one and opens nothing until it is listed", () => {
    // The engine owns the page, so the window arrives with the list.
    const state = reduce(
      desktop("kitty"),
      WindowAction.BrowserOpened("https://example.com/"),
    );

    expect(state.windows).toHaveLength(1);
  });

  it("names a window after the site its page is at now", () => {
    const state = reduce(
      desktop(),
      WindowAction.BrowserWindowsListed([listed("1", "https://example.com/")]),
      WindowAction.BrowserWindowsListed([listed("1", "https://docs.rs/")]),
    );

    expect(state.windows).toHaveLength(1);
    expect(state.windows[0]).toMatchObject({ title: "docs.rs" });
  });

  it("takes a window away when the engine no longer lists it", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.BrowserWindowsListed([listed("1", "https://example.com/")]),
      WindowAction.BrowserWindowsListed([]),
    );

    expect(state.windows.map(({ id }) => id)).toEqual([APP("kitty")]);
  });

  it("leaves a browser window for the engine to close", () => {
    // `closeBrowserWindow` is asked, and the window goes when the list says.
    const state = reduce(
      desktop(),
      WindowAction.BrowserWindowsListed([listed("1", "https://example.com/")]),
      WindowAction.WindowKilled(),
    );

    expect(state.windows).toHaveLength(1);
  });

  it("leaves a client's window for the client to close", () => {
    // `closeApp` is a request: an editor with unsaved work may stay open, so
    // the window is removed only when the host reports it closed.
    const state = reduce(desktop("editor"), WindowAction.WindowKilled());

    expect(state.windows).toHaveLength(1);
  });
});

// `chrome.windows.create` with a popup (such as Bitwarden's "Unlock"), opened
// as a browser window owned by the extension.
describe("the windows an extension asks for", () => {
  const POPUP = "chrome-extension://vault/popup/index.html?uilocation=popout";

  /** The one float on the workspace on screen. */
  const floatOf = (state: WindowState) => {
    const [float] = workspaceHere(state).floats;
    if (float === undefined) {
      throw new Error("nothing is floating");
    } else {
      return float;
    }
  };

  it("opens one floating in front, the size it asked for, and works in it", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.BrowserWindowsListed([
        listed("1", POPUP, { height: 630, popupWindow: 7, width: 380 }),
      ]),
    );

    expect(activeIdOf(state)).toBe(BROWSER("1"));
    expect(state.windows[1]).toMatchObject({ popupWindow: 7 });
    expect(floatOf(state)).toMatchObject({ height: 630, width: 380 });
  });

  // 0 means the extension gave no size on that axis.
  it("opens at a float's own size on an axis it did not ask about", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left")),
      WindowAction.BrowserWindowsListed([
        listed("1", POPUP, { height: 630, popupWindow: 7, width: 0 }),
      ]),
    );

    expect(floatOf(state)).toMatchObject({ height: 630, width: 1280 });
  });
});

describe("the screens", () => {
  it("is one screen nobody has named until the host describes a desk", () => {
    // A window can open before the handshake, so a screen always exists. No
    // display is named "", so nothing is drawn on it.
    expect(NO_WINDOWS.screens).toEqual([
      {
        box: { height: 0, width: 0, x: 0, y: 0 },
        current: "1",
        name: "",
      },
    ]);
    expect(NO_WINDOWS.focused).toBe("");
  });

  it("gives the first named screen what the unnamed one was showing", () => {
    // A window opened before the desk was described keeps its workspace, which
    // the first real screen then shows.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
    );

    expect(currentOn(state, "left")).toBe("1");
    expect(state.focused).toBe("left");
    expect(windowsOn(workspaceOn(state, "left"))).toEqual([APP("kitty")]);
  });

  it("finds the screen a client's window is on, for its dialogs", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
    );

    expect(screenOfApp(state, "kitty")).toBe("left");
    expect(screenOfApp(state, "closed")).toBeUndefined();
  });

  it("shows a workspace nobody else is on when a monitor is plugged in", () => {
    // Two screens on one workspace would embed each window twice, and the
    // second embedding takes the first's pixels.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left")),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
    );

    expect(currentOn(state, "left")).toBe("1");
    expect(currentOn(state, "right")).toBe("2");
  });

  it("leaves a screen that was already there showing what it was", () => {
    // Every hotplug re-describes the whole desk, so unaffected monitors must
    // keep their workspaces.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.WorkspaceSelected("5"),
      WindowAction.ScreensDescribed(sideBySide("left", "right", "third")),
    );

    expect(currentOn(state, "left")).toBe("5");
    expect(currentOn(state, "right")).toBe("2");
  });

  it("keeps where each screen is on the desk, as the host last said", () => {
    // `focus left` uses these positions, and moving a monitor in display
    // settings re-describes it.
    const state = reduce(
      desktop(),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.ScreensDescribed(sideBySide("right", "left")),
    );

    expect(state.screens.map(({ box, name }) => [name, box.x])).toEqual([
      ["right", 0],
      ["left", 1920],
    ]);
  });

  it("hands a swapped monitor what the one it replaced was showing", () => {
    // A dock change renames every output. Workspaces carry over instead of
    // every monitor resetting to workspace 1.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      // Switch to the right monitor, then to a workspace on it.
      WindowAction.WorkspaceSelected("2"),
      WindowAction.WorkspaceSelected("7"),
      WindowAction.ScreensDescribed(sideBySide("left", "docked")),
    );

    expect(currentOn(state, "docked")).toBe("7");
    expect(currentOn(state, "left")).toBe("1");
  });

  it("moves the keyboard to the first screen when the one it was on goes", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.ScreensDescribed(sideBySide("left")),
    );

    expect(state.focused).toBe("left");
  });

  it("keeps the desktop on one unnamed screen when the last monitor goes", () => {
    // A laptop lid closed with nothing plugged in. Windows stay on their
    // workspaces; the empty name means there is nowhere to draw them.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left")),
      WindowAction.ScreensDescribed(sideBySide()),
    );

    expect(state.screens).toEqual([
      {
        box: { height: 0, width: 0, x: 0, y: 0 },
        current: "1",
        name: "",
      },
    ]);
    expect(windowsOn(workspaceOn(state, ""))).toEqual([APP("kitty")]);
  });
});

describe("a key pressed on the desk", () => {
  it("is counted", () => {
    // Counted in the desk state because the monitor that receives focus answers
    // it by warping the pointer.
    const pressed = reduce(
      NO_WINDOWS,
      WindowAction.KeyPressed(),
      WindowAction.KeyPressed(),
    ).pressed;

    expect(pressed).toBe(2);
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
    // As in sway, focus moves to the screen showing the workspace instead of
    // moving the workspace. Moving it would leave one monitor empty.
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.WorkspaceSelected("2"),
    );

    expect(state.focused).toBe("right");
    expect(currentOn(state, "left")).toBe("1");
    expect(currentOn(state, "right")).toBe("2");
  });

  it("shows a workspace nobody is showing on the screen the keyboard is on", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.WorkspaceSelected("9"),
    );

    expect(state.focused).toBe("left");
    expect(currentOn(state, "left")).toBe("9");
    expect(currentOn(state, "right")).toBe("2");
  });

  it("opens a window on the screen the keyboard is on", () => {
    // A new window opens on the focused screen, not always on the first.
    const state = reduce(
      desktop(),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
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

  it("tiles it there even while a floating group has the keyboard", () => {
    // Only a newly opened window joins the floating group; a window sent here
    // lands tiled.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.ContainerSplit(Axis.Vertical),
      WindowAction.AppAppeared("mail", "mail"),
      WindowAction.ParentFocused(),
      WindowAction.FloatToggled(),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.AppAppeared("term", "term"),
      WindowAction.WindowSentToWorkspace("1"),
    );

    expect(windowsOf(workspaceNamed(state, "1").tiling)).toEqual([
      APP("kitty"),
      APP("term"),
    ]);
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
   * Two monitors: kitty on the left one's workspace 1, and an editor on
   * workspace 2, which the right one showed before switching to 3.
   */
  const twoScreens = (): WindowState =>
    reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.AppAppeared("editor", "editor"),
      WindowAction.WorkspaceSelected("3"),
    );

  it("keeps a workspace on the screen it was last shown on", () => {
    // As in sway, a workspace belongs to one output, and only that output's bar
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
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.WindowSentToWorkspace("5"),
    );

    expect(workspacesOn(state, "left")).toEqual(["1", "5"]);
    expect(workspacesOn(state, "right")).toEqual(["2"]);
  });

  it("hands the workspaces of a monitor that goes to the screen the keyboard is on", () => {
    const state = reduce(
      twoScreens(),
      WindowAction.WorkspaceSelected("1"),
      WindowAction.ScreensDescribed(sideBySide("left")),
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
    expect(
      workspaceHere(state).floats.flatMap(({ root }) => windowsIn(root)),
    ).toEqual([APP("editor")]);
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

describe("focus across screens", () => {
  /** Kitty on the left screen; the editor and a terminal on the right. */
  const twoScreens = () =>
    reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.AppAppeared("editor", "editor"),
      WindowAction.AppAppeared("term", "term"),
    );

  it("goes on to the screen that way from the edge of the tiling", () => {
    // sway's order: a window that way, then a screen that way, then wrap.
    const state = reduce(
      twoScreens(),
      WindowAction.FocusStepped(Direction.Left),
      WindowAction.FocusStepped(Direction.Left),
    );

    expect(state.focused).toBe("left");
    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("comes in by the window on the near edge", () => {
    const state = reduce(
      twoScreens(),
      WindowAction.LayoutSet(Layout.SplitH),
      WindowAction.ScreenHovered("left"),
      WindowAction.FocusStepped(Direction.Right),
    );

    expect(state.focused).toBe("right");
    expect(activeIdOf(state)).toBe(APP("editor"));
  });

  it("goes on to a screen with nothing on it", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.FocusStepped(Direction.Right),
    );

    expect(state.focused).toBe("right");
    expect(activeIdOf(state)).toBeUndefined();
  });

  it("leaves a screen with nothing on it", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.ScreenHovered("right"),
      WindowAction.FocusStepped(Direction.Left),
    );

    expect(state.focused).toBe("left");
    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("wraps round where no screen lies that way", () => {
    const state = reduce(
      twoScreens(),
      WindowAction.FocusStepped(Direction.Right),
    );

    expect(state.focused).toBe("right");
    expect(activeIdOf(state)).toBe(APP("editor"));
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
    const stacked = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.Stacking),
    );
    expect(workspaceHere(stacked).tiling.root).toMatchObject({
      layout: Layout.Stacking,
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
    expect(
      workspaceHere(floated).floats.flatMap(({ root }) => windowsIn(root)),
    ).toEqual([APP("editor")]);

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

  it("changes the mode the keys are read in, on every page of the desk", () => {
    const state = reduce(desktop(), WindowAction.ModeSet("resize"));

    expect(state.mode).toBe("resize");
  });

  it("leaves the state alone for an `exec`, which is the compositor's to spawn", () => {
    const state = desktop("kitty");

    expect(reduceWindows(state, WindowAction.CommandExecuted(["kitty"]))).toBe(
      state,
    );
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
    // Pressing the top bar gives keyboard focus to the page, but the active
    // window is unchanged.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FocusChanged(undefined),
    );

    expect(state.focusedId).toBeUndefined();
    expect(activeIdOf(state)).toBe(APP("editor"));
  });

  it("says nothing twice", () => {
    // The host reports focus to a newly connected chrome, which usually matches
    // the existing state.
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
      WindowAction.LayoutSet(Layout.SplitH),
      WindowAction.WindowHovered(APP("kitty")),
    );

    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("raises a floating window it crosses into", () => {
    // Applies to every window kind, including browser windows with no client.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.FloatToggled(),
      WindowAction.WindowHovered(APP("kitty")),
      WindowAction.FloatToggled(),
      WindowAction.WindowHovered(APP("editor")),
    );

    expect(
      workspaceHere(state).floats.flatMap(({ root }) => windowsIn(root)),
    ).toEqual([APP("kitty"), APP("editor")]);
  });

  // Crossing a tab row enters the container, so focus goes to its shown tab.
  // Only a click changes the shown tab.
  it("goes to the open tab of a container whose hidden tab it crosses", () => {
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.SplitH),
      WindowAction.ContainerSplit(Axis.Vertical),
      WindowAction.AppAppeared("mail", "mail"),
      WindowAction.LayoutSet(Layout.Tabbed),
      WindowAction.FocusStepped(Direction.Left),
      WindowAction.FocusStepped(Direction.Left),
      WindowAction.WindowHovered(APP("mail")),
    );

    expect(activeIdOf(state)).toBe(APP("editor"));
  });

  it("goes to the open tab of a floating group whose hidden tab it crosses", () => {
    const state = reduce(
      desktop("mail", "kitty"),
      WindowAction.ContainerSplit(Axis.Vertical),
      WindowAction.AppAppeared("editor", "editor"),
      WindowAction.LayoutSet(Layout.Tabbed),
      WindowAction.ParentFocused(),
      WindowAction.FloatToggled(),
      WindowAction.ModeSwapped(),
      WindowAction.WindowHovered(APP("kitty")),
    );

    expect(activeIdOf(state)).toBe(APP("editor"));
  });

  it("goes to a fullscreen window a tab opened since would hide", () => {
    // A fullscreen window is visible regardless of the tree.
    const state = reduce(
      desktop("kitty"),
      WindowAction.FullscreenToggled(false),
      WindowAction.AppAppeared("editor", "editor"),
      WindowAction.WindowHovered(APP("kitty")),
    );

    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("reports a window on another workspace as nothing at all", () => {
    // The page cannot report this, since an off-screen window has no box, and
    // it would focus something invisible.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToWorkspace("2"),
    );

    expect(
      reduceWindows(state, WindowAction.WindowHovered(APP("editor"))),
    ).toBe(state);
  });

  it("answers a press in the window it is already in with the same state", () => {
    // `AppWindow` reports every press, most of which change nothing. Returning
    // a new object would re-render the desktop on every click and undo `focus
    // parent`.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.ParentFocused(),
    );

    expect(
      reduceWindows(state, WindowAction.WindowSelected(APP("editor"))),
    ).toBe(state);
  });

  it("goes to the workspace of a window that asks to be reached", () => {
    // `xdg-activation`, which this shell grants. The window already has its
    // workspace's focus, so granting means switching to that workspace.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.WindowSentToWorkspace("2"),
    );

    expect(
      currentHere(reduceWindows(state, WindowAction.FocusRequested("editor"))),
    ).toBe("2");
  });

  it("moves the keyboard to the screen the window it crossed is on", () => {
    // Focus follows the pointer across monitors. Each screen is its own page,
    // so the page that saw the pointer reports it.
    const state = reduce(
      desktop(),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.AppAppeared("kitty", "kitty"),
      WindowAction.WorkspaceSelected("2"),
      WindowAction.AppAppeared("editor", "editor"),
      WindowAction.WindowHovered(APP("kitty")),
    );

    expect(state.focused).toBe("left");
    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("moves the keyboard to a screen it crossed onto with no window under it", () => {
    // As in sway, focus follows the pointer onto an empty output, where the
    // next window should open.
    const state = reduce(
      desktop(),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.AppAppeared("kitty", "kitty"),
      WindowAction.ScreenHovered("right"),
    );

    expect(state.focused).toBe("right");
    expect(activeIdOf(state)).toBeUndefined();
  });

  it("answers a pointer on the screen the keyboard is on with the same state", () => {
    // Reported on every pointer move, so a no-op must return the same state.
    const state = reduce(
      desktop(),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
    );

    expect(reduceWindows(state, WindowAction.ScreenHovered("left"))).toBe(
      state,
    );
  });

  it("leaves the keyboard where it is for a screen the desk has not taken up", () => {
    // A new monitor's page can see the pointer before the reducer learns the
    // screen exists.
    const state = reduce(
      desktop(),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
    );

    expect(reduceWindows(state, WindowAction.ScreenHovered("docked"))).toBe(
      state,
    );
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

  it("retiles a tiled window where it was dropped on another", () => {
    const state = reduce(
      desktop("kitty", "editor", "browser"),
      WindowAction.WindowDroppedOn(APP("kitty"), APP("browser"), undefined),
    );

    expect(windowsOf(workspaceHere(state).tiling)).toEqual([
      APP("browser"),
      APP("editor"),
      APP("kitty"),
    ]);
    expect(activeIdOf(state)).toBe(APP("kitty"));
  });

  it("drags a tiled window's edge by a share of the screen it is on", () => {
    // Two windows share a 1060px screen minus three 20px gaps, one between
    // them and one at each edge, so 100px is a tenth of their share.
    const state = reduce(
      desktop("kitty", "editor"),
      WindowAction.LayoutSet(Layout.SplitH),
      WindowAction.WindowStretched(APP("kitty"), Direction.Right, 100, {
        height: 800,
        width: 1060,
        x: 0,
        y: 0,
      }),
    );

    expect(workspaceHere(state).tiling.root).toMatchObject({
      fractions: [0.6, 0.4],
    });
  });

  it("puts a dragged window where it was dropped", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.FloatToggled(),
      WindowAction.WindowMoved(APP("kitty"), 300, 200),
      WindowAction.WindowResized(APP("kitty"), {
        height: 600,
        width: 800,
        x: 250,
        y: 150,
      }),
    );

    // A resize from the top-left corner moves the window as well.
    expect(workspaceHere(state).floats[0]).toMatchObject({
      height: 600,
      width: 800,
      x: 250,
      y: 150,
    });
  });
});

describe("a floating window dragged across screens", () => {
  /** Kitty floating on the left of two screens, grabbed. */
  const held = () =>
    reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.FloatToggled(),
      WindowAction.WindowGrabbed(APP("kitty")),
    );

  it("goes to the screen its middle crosses onto, in that screen's pixels", () => {
    // 640 wide from 1700 puts its center at 2020, 100 past the edge.
    const state = reduce(
      held(),
      WindowAction.WindowMoved(APP("kitty"), 1700, 100),
    );

    expect(windowsOn(workspaceOn(state, "left"))).toEqual([]);
    expect(workspaceOn(state, "right").floats[0]).toMatchObject({
      x: -220,
      y: 100,
    });
    expect(state.focused).toBe("right");
    expect(activeIdOf(state)).toBe(APP("kitty"));
    expect(state.draggingId).toBe(APP("kitty"));
  });

  it("takes the drag in the page's pixels, whichever screen it is on", () => {
    // One page spans the desk, so drags use desk coordinates: the second move
    // lands on the right screen at 1800 - 1920.
    const state = reduce(
      held(),
      WindowAction.WindowMoved(APP("kitty"), 1700, 100),
      WindowAction.WindowMoved(APP("kitty"), 1800, 120),
    );

    expect(workspaceOn(state, "right").floats[0]).toMatchObject({
      x: -120,
      y: 120,
    });
  });

  it("comes back to the screen its middle crosses back onto", () => {
    const state = reduce(
      held(),
      WindowAction.WindowMoved(APP("kitty"), 1700, 100),
      WindowAction.WindowMoved(APP("kitty"), 1000, 100),
    );

    expect(windowsOn(workspaceOn(state, "right"))).toEqual([]);
    expect(workspaceOn(state, "left").floats[0]).toMatchObject({
      x: 1000,
      y: 100,
    });
    expect(state.focused).toBe("left");
  });

  it("stays on its screen while its middle is on no screen at all", () => {
    const state = reduce(
      held(),
      WindowAction.WindowMoved(APP("kitty"), 1700, -1000),
    );

    expect(workspaceOn(state, "left").floats[0]).toMatchObject({
      x: 1700,
      y: -1000,
    });
    expect(state.focused).toBe("left");
  });

  it("takes a browser window across like any other", () => {
    // The desk draws each window once, so the `<webview>` keeps its element and
    // does not reload. See docs/architecture/ONE-PAGE-FOR-THE-DESK.md.
    const state = reduce(
      desktop(),
      WindowAction.ScreensDescribed(sideBySide("left", "right")),
      WindowAction.BrowserWindowsListed([listed("1", "https://example.com/")]),
      WindowAction.FloatToggled(),
      WindowAction.WindowMoved(BROWSER("1"), 1700, 100),
    );

    expect(windowsOn(workspaceOn(state, "left"))).toEqual([]);
    expect(workspaceOn(state, "right").floats[0]).toMatchObject({
      x: -220,
      y: 100,
    });
    expect(state.focused).toBe("right");
  });
});

describe("the buttons on a window's own title bar", () => {
  it("fills the screen with the window whose bar it is, not the one being worked in", () => {
    // A title bar button acts on its own window, not the focused one.
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
    // The same toggle as `mod+f`.
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
    // Same as the launcher: the key that opens the panel also closes it.
    const opened = reduce(NO_WINDOWS, WindowAction.ClipboardToggled());
    expect(opened.clipboardOpen).toBe(true);

    expect(reduce(opened, WindowAction.ClipboardToggled()).clipboardOpen).toBe(
      false,
    );
  });

  it("shuts when it is dismissed, however many times", () => {
    // Escape, a backdrop click and choosing a row all report a close, so
    // dismissing a closed panel must be a no-op.
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
    // One binding: pressing `mod+space` again to close is the same reflex as
    // Escape.
    const opened = reduce(NO_WINDOWS, WindowAction.LauncherToggled());
    expect(opened.launcherOpen).toBe(true);

    expect(reduce(opened, WindowAction.LauncherToggled()).launcherOpen).toBe(
      false,
    );
  });

  it("shuts when it is dismissed, however many times", () => {
    // Escape and a backdrop click both report a close, and the dialog also
    // reports its own closing, so dismissing a closed launcher must be a no-op.
    const dismissed = reduce(
      NO_WINDOWS,
      WindowAction.LauncherToggled(),
      WindowAction.LauncherDismissed(),
      WindowAction.LauncherDismissed(),
    );

    expect(dismissed.launcherOpen).toBe(false);
  });

  it("shuts behind the browser window it opened", () => {
    // Leaving the launcher over the new window would force the user to dismiss
    // it. The launch action closes it on both query paths.
    const launched = reduce(
      NO_WINDOWS,
      WindowAction.LauncherToggled(),
      WindowAction.BrowserOpened("https://example.com"),
    );

    expect(launched.launcherOpen).toBe(false);
  });

  it("shuts behind the application it ran, and opens no window itself", () => {
    // The application is a Wayland client, as with opening a file.
    const launched = reduce(
      NO_WINDOWS,
      WindowAction.LauncherToggled(),
      WindowAction.AppLaunched(["gedit"]),
    );

    expect(launched.launcherOpen).toBe(false);
    expect(launched.windows).toStrictEqual([]);
  });

  it("shuts behind the file it opened, and opens no window itself", () => {
    // The file opener is a spawned Wayland client, so its window arrives
    // through `app_appeared`, as with `CommandExecuted`.
    const launched = reduce(
      NO_WINDOWS,
      WindowAction.LauncherToggled(),
      WindowAction.FileOpened("Notes/today.org"),
    );

    expect(launched.launcherOpen).toBe(false);
    expect(launched.windows).toStrictEqual([]);
  });
});

describe("a client's limits on its size", () => {
  /** The one float on the workspace on screen. */
  const floatOf = (state: WindowState) => {
    const [float] = workspaceHere(state).floats;
    if (float === undefined) {
      throw new Error("nothing is floating");
    } else {
      return float;
    }
  };

  it("float a window no smaller than its client will draw", () => {
    // Bitwarden's 680x500 minimum exceeds the default float size when no screen
    // is described. Smaller, its frame would be cut off at the box's edge. Its
    // bar comes on top.
    const state = reduce(
      desktop("vault"),
      WindowAction.AppMinSize("vault", [680, 500]),
      WindowAction.FloatToggled(),
    );

    expect(floatOf(state)).toMatchObject({
      height: 500 + TITLE_BAR,
      width: 680,
    });
  });

  it("float a window no bigger than the screen the keyboard is on", () => {
    const state = reduce(
      desktop("kitty"),
      WindowAction.ScreensDescribed([
        { box: { height: 400, width: 600, x: 0, y: 0 }, name: "small" },
      ]),
      WindowAction.FloatToggled(),
    );

    expect(floatOf(state).width).toBeLessThanOrEqual(600);
    expect(floatOf(state).height).toBeLessThanOrEqual(400);
  });

  it("grow a float when the limit arrives after it", () => {
    // A client sends its limits on its own commit, which can come after the
    // window was floated.
    const state = reduce(
      desktop("vault"),
      WindowAction.FloatToggled(),
      WindowAction.AppMinSize("vault", [680, undefined]),
    );

    expect(floatOf(state).width).toBe(680);
  });

  it("stop a float being dragged past the largest its client will draw", () => {
    const floated = reduce(
      desktop("dialog"),
      WindowAction.AppMaxSize("dialog", [700, undefined]),
      WindowAction.FloatToggled(),
    );
    const { x, y } = floatOf(floated);

    const state = reduce(
      floated,
      WindowAction.WindowResized(APP("dialog"), {
        height: 900,
        width: 1200,
        x,
        y,
      }),
    );

    expect(floatOf(state)).toMatchObject({ height: 900, width: 700, x, y });
  });

  it("keep the edge nobody dragged where it was", () => {
    // Dragged in from the left, the right edge stays put, so a window at its
    // minimum stops instead of sliding right.
    const floated = reduce(
      desktop("vault"),
      WindowAction.AppMinSize("vault", [680, undefined]),
      WindowAction.FloatToggled(),
    );
    const before = floatOf(floated);
    const right = before.x + before.width;

    const state = reduce(
      floated,
      WindowAction.WindowResized(APP("vault"), {
        height: before.height,
        width: before.width - 100,
        x: before.x + 100,
        y: before.y,
      }),
    );

    expect(floatOf(state)).toMatchObject({ width: 680, x: right - 680 });
  });
});

describe("a client's popups", () => {
  const MENU = {
    appId: "menu",
    parent: "term",
    position: [12, 30],
    size: [180, 240],
  } as const;

  it("are held as they are placed, and moved in place", () => {
    const state = reduce(
      desktop("term"),
      WindowAction.PopupPlaced(MENU),
      WindowAction.PopupPlaced({ ...MENU, position: [40, 30] }),
    );

    expect(state.popups).toEqual([{ ...MENU, position: [40, 30] }]);
    // Popups are never windows: a menu in its own frame is a bug.
    expect(state.windows.map(({ id }) => id)).toEqual([APP("term")]);
  });

  it("go when the client closes them, and leave the window alone", () => {
    const state = reduce(
      desktop("term"),
      WindowAction.PopupPlaced(MENU),
      WindowAction.AppClosed("menu"),
    );

    expect(state.popups).toEqual([]);
    expect(state.windows.map(({ id }) => id)).toEqual([APP("term")]);
  });
});
