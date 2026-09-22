import { describe, expect, it } from "bun:test";

import { Axis, Direction } from "../window-management/direction";
import { Layout } from "../window-management/tree/node";
import {
  BindingMode,
  WindowAction,
  WindowActionKind,
  WORKSPACES,
} from "../window-management/window-state";
import { actionForCode, actionForKeycode, BINDINGS, CHORDS } from "./bindings";
import { codeFor } from "./programmers-dvorak";

const pressing = (keysym: string, shift = false, mode = BindingMode.Default) =>
  actionForCode(mode, codeFor(keysym), shift);

describe("the default bindings", () => {
  it("moves the focus with the keys the config names", () => {
    expect(pressing("h")).toEqual(WindowAction.FocusStepped(Direction.Left));
    expect(pressing("j")).toEqual(WindowAction.FocusStepped(Direction.Down));
    expect(pressing("k")).toEqual(WindowAction.FocusStepped(Direction.Up));
    expect(pressing("l")).toEqual(WindowAction.FocusStepped(Direction.Right));
  });

  it("answers the arrow keys the same way", () => {
    expect(pressing("Left")).toEqual(WindowAction.FocusStepped(Direction.Left));
    expect(pressing("Up", true)).toEqual(
      WindowAction.WindowStepped(Direction.Up),
    );
  });

  it("moves the window with Shift held", () => {
    expect(pressing("l", true)).toEqual(
      WindowAction.WindowStepped(Direction.Right),
    );
  });

  it("switches workspaces on the number row the config uses", () => {
    expect(pressing("parenleft")).toEqual(WindowAction.WorkspaceSelected("1"));
    expect(pressing("asterisk")).toEqual(WindowAction.WorkspaceSelected("10"));
    expect(pressing("parenright", true)).toEqual(
      WindowAction.WindowSentToWorkspace("2"),
    );
  });

  it("splits, rearranges and fills the screen", () => {
    expect(pressing("b")).toEqual(WindowAction.ContainerSplit(Axis.Horizontal));
    expect(pressing("v")).toEqual(WindowAction.ContainerSplit(Axis.Vertical));
    expect(pressing("w")).toEqual(WindowAction.LayoutSet(Layout.Tabbed));
    expect(pressing("s")).toEqual(WindowAction.LayoutSet(Layout.Stacking));
    expect(pressing("e")).toEqual(WindowAction.SplitToggled());
    expect(pressing("f")).toEqual(WindowAction.FullscreenToggled(false));
    expect(pressing("f", true)).toEqual(WindowAction.FullscreenToggled(true));
  });

  it("swaps and toggles the floating layer with Tab", () => {
    expect(pressing("Tab")).toEqual(WindowAction.ModeSwapped());
    expect(pressing("Tab", true)).toEqual(WindowAction.FloatToggled());
  });

  it("launches a terminal and kills a window", () => {
    expect(pressing("Return")).toEqual(WindowAction.TerminalLaunched());
    expect(pressing("q", true)).toEqual(WindowAction.WindowKilled());
  });

  it("opens the launcher on both keys the config puts one on", () => {
    // `mod+space` is the user's own binding and `mod+d` is what sway's
    // defaults leave under it. Both reach the same panel, so a person who
    // learned either key has the launcher.
    expect(pressing("space")).toEqual(WindowAction.LauncherToggled());
    expect(pressing("d")).toEqual(WindowAction.LauncherToggled());
  });

  it("works the scratchpad", () => {
    expect(pressing("minus")).toEqual(WindowAction.ScratchpadShown());
    expect(pressing("minus", true)).toEqual(
      WindowAction.WindowSentToScratchpad(),
    );
  });

  it("answers nothing for a chord nobody bound", () => {
    expect(pressing("z")).toBeUndefined();
  });

  it("opens the clipboard on the key a clipboard manager is reached by", () => {
    // Shift+v, which is where every sway config that has one puts it: `mod+v`
    // is already the vertical split, and the paste key with Shift is what a
    // person reaches for when the thing they want is one copy back.
    expect(pressing("v", true)).toEqual(WindowAction.ClipboardToggled());
  });

  it("has a key for every workspace the desktop has", () => {
    // The two lists are written out separately — one is the keyboard's order
    // and the other the numbers' — so this is what says they still agree.
    const reachable = WORKSPACES.filter((name) =>
      BINDINGS.some(
        ({ action }) =>
          action.kind === WindowActionKind.WorkspaceSelected &&
          action.name === name,
      ),
    );

    expect(reachable).toEqual([...WORKSPACES]);
  });
});

describe("resize mode", () => {
  it("is entered and left the way the config says", () => {
    expect(pressing("r")).toEqual(WindowAction.ModeSet(BindingMode.Resize));
    expect(pressing("Return", false, BindingMode.Resize)).toEqual(
      WindowAction.ModeSet(BindingMode.Default),
    );
    expect(pressing("Escape", false, BindingMode.Resize)).toEqual(
      WindowAction.ModeSet(BindingMode.Default),
    );
  });

  it("resizes with the same keys that move the focus otherwise", () => {
    expect(pressing("l", false, BindingMode.Resize)).toEqual(
      WindowAction.WindowGrown(Direction.Right),
    );
    expect(pressing("k", false, BindingMode.Resize)).toEqual(
      WindowAction.WindowGrown(Direction.Up),
    );
  });

  it("answers nothing else at all, the way a sway mode does not", () => {
    expect(pressing("parenleft", false, BindingMode.Resize)).toBeUndefined();
  });
});

describe("what the compositor is asked to claim", () => {
  it("claims every chord with the desktop's modifier and no other", () => {
    // Meta is the modifier — Mod4, the key the sway config names.
    expect(CHORDS.length).toBeGreaterThan(0);
    for (const chord of CHORDS) {
      expect(chord).toMatchObject({
        altKey: false,
        ctrlKey: false,
        metaKey: true,
      });
      expect(chord.keycode).toBeGreaterThan(0);
    }
  });

  it("claims each chord once, however many modes bind it", () => {
    // `mod+Return` is a terminal in the default mode and the way out of
    // resize mode, and the compositor knows nothing about modes.
    const seen = CHORDS.map(
      ({ keycode, shiftKey }) => `${keycode.toString()}:${String(shiftKey)}`,
    );

    expect(new Set(seen).size).toBe(seen.length);
  });

  it("answers a claimed chord coming back from the host", () => {
    // Which is how a press reaches the shell while a browser window has the
    // keyboard: the browser process matches the claim and hands it back by
    // keycode rather than as a key event.
    expect(actionForKeycode(BindingMode.Default, 28, false)).toEqual(
      WindowAction.TerminalLaunched(),
    );
  });
});
