// The desktop's keys, as the user's sway config binds them.
//
// One table, read from two places, because two different things can be holding
// the keyboard when a chord is pressed: this page hears a `keydown` for every
// press that lands on the document — its own chrome, and a focused Wayland
// window too, since an `<app>` is an element here — and the browser process
// hands back a `shortcut` message for the ones a `<webview>` swallowed. So
// every binding carries both spellings of its key: the `code` a key event
// names, and the evdev keycode the control channel speaks.
//
// **The modifier is Meta**, which is Mod4 — the key the config sets. What
// makes the whole table possible is the claim: a chord the compositor has
// claimed is not delivered to any client, so `mod+h` can be the desktop's
// while `h` stays the window's.
//
// The keysyms are the config's own — `h`, `parenleft`, `Return` — and
// `programmers-dvorak.ts` is what turns each into the key it is on. Read that
// file before adding a binding.

import type { DomicileShortcut } from "@domicile/chrome-sdk/domicile-host";
import { evdevFromCode } from "@domicile/chrome-sdk/input";

import { Axis, Direction } from "../window-management/direction";
import { Layout } from "../window-management/tree/node";
import type { WindowAction } from "../window-management/window-state";
import {
  WindowAction as Action,
  BindingMode,
} from "../window-management/window-state";
import { codeFor } from "./programmers-dvorak";

/** One key, and what the desktop does with it. */
export type Binding = {
  action: WindowAction;
  /** What the compositor is asked to claim, and what it hands back. */
  chord: DomicileShortcut;
  /** The physical key, as a `KeyboardEvent.code` names it. */
  code: string;
  mode: BindingMode;
  shift: boolean;
};

/** The four directions, by the keysym the config moves each way with. */
const DIRECTIONS: readonly (readonly [keysym: string, way: Direction])[] = [
  ["h", Direction.Left],
  ["j", Direction.Down],
  ["k", Direction.Up],
  ["l", Direction.Right],
  ["Left", Direction.Left],
  ["Down", Direction.Down],
  ["Up", Direction.Up],
  ["Right", Direction.Right],
];

/**
 * The workspace keys, in the order the config's number row names them.
 *
 * Written out rather than counted off the number row, because that is how the
 * config reads: `mod+parenleft` is the first workspace and `mod+asterisk` the
 * tenth, and the keysyms are in neither the order of the keys nor the order of
 * the numbers they print when shifted.
 */
const WORKSPACE_KEYS: readonly (readonly [keysym: string, name: string])[] = [
  ["parenleft", "1"],
  ["parenright", "2"],
  ["braceright", "3"],
  ["plus", "4"],
  ["braceleft", "5"],
  ["bracketright", "6"],
  ["bracketleft", "7"],
  ["exclam", "8"],
  ["equal", "9"],
  ["asterisk", "10"],
];

const bound = (
  keysym: string,
  shift: boolean,
  action: WindowAction,
  mode = BindingMode.Default,
): Binding => {
  const code = codeFor(keysym);
  const keycode = evdevFromCode(code);
  if (keycode === undefined) {
    throw new Error(`keyboard: the key ${code} has no evdev code`);
  } else {
    return {
      action,
      // Every modifier is named rather than left to the dictionary's default:
      // the compositor matches the set it was given and nothing else, so the
      // ones that must *not* be held are as much of the chord as Meta is.
      chord: {
        altKey: false,
        ctrlKey: false,
        keycode,
        metaKey: true,
        shiftKey: shift,
      },
      code,
      mode,
      shift,
    };
  }
};

export const BINDINGS: readonly Binding[] = [
  // What the config binds itself, and what `lib.mkOptionDefault` leaves under
  // it: sway's own defaults for everything the user did not rebind.
  bound("Return", false, Action.TerminalLaunched()),
  bound("q", true, Action.WindowKilled()),
  // The launcher's key in both places the config puts one — `mod+space` in
  // the user's own bindings and `mod+d` in sway's defaults. Both are the same
  // panel rather than one of them being a lesser version: a person who learned
  // either key has the launcher.
  //
  // A toggle, because the same press is what you reach for to open it and to
  // give up on it. Escape and the backdrop close it too, and those arrive from
  // the dialog rather than from here — see `launcher/Launcher.tsx`.
  bound("space", false, Action.LauncherToggled()),
  bound("d", false, Action.LauncherToggled()),

  ...DIRECTIONS.map(([keysym, way]) =>
    bound(keysym, false, Action.FocusStepped(way)),
  ),
  ...DIRECTIONS.map(([keysym, way]) =>
    bound(keysym, true, Action.WindowStepped(way)),
  ),

  bound("b", false, Action.ContainerSplit(Axis.Horizontal)),
  bound("v", false, Action.ContainerSplit(Axis.Vertical)),
  bound("s", false, Action.LayoutSet(Layout.Stacking)),
  bound("w", false, Action.LayoutSet(Layout.Tabbed)),
  bound("e", false, Action.SplitToggled()),
  bound("a", false, Action.ParentFocused()),
  bound("a", true, Action.ChildFocused()),

  bound("f", false, Action.FullscreenToggled(false)),
  bound("f", true, Action.FullscreenToggled(true)),

  // The config's own: Tab swaps between the floating windows and the tiled
  // ones, and Shift+Tab is what floats a window in the first place.
  bound("Tab", false, Action.ModeSwapped()),
  bound("Tab", true, Action.FloatToggled()),

  bound("minus", false, Action.ScratchpadShown()),
  bound("minus", true, Action.WindowSentToScratchpad()),

  bound("r", false, Action.ModeSet(BindingMode.Resize)),

  // The workspace keys are the number row as Programmer's Dvorak lays it out,
  // which is what the config names: `parenleft` for the first, and so on.
  ...WORKSPACE_KEYS.map(([keysym, name]) =>
    bound(keysym, false, Action.WorkspaceSelected(name)),
  ),
  ...WORKSPACE_KEYS.map(([keysym, name]) =>
    bound(keysym, true, Action.WindowSentToWorkspace(name)),
  ),

  // And the mode `mod+r` enters, where the same keys resize instead. Every
  // one of them needs the modifier, which sway's does not: a claim on a bare
  // key would take it from every client for the whole session, and the
  // channel has no way to give one back.
  ...DIRECTIONS.map(([keysym, way]) =>
    bound(keysym, false, Action.WindowGrown(way), BindingMode.Resize),
  ),
  bound(
    "Return",
    false,
    Action.ModeSet(BindingMode.Default),
    BindingMode.Resize,
  ),
  bound(
    "Escape",
    false,
    Action.ModeSet(BindingMode.Default),
    BindingMode.Resize,
  ),
];

/** What the desktop asks the compositor for, each chord once. */
export const CHORDS: readonly DomicileShortcut[] = BINDINGS.filter(
  (binding, at) =>
    BINDINGS.findIndex(
      (found) =>
        found.chord.keycode === binding.chord.keycode &&
        found.shift === binding.shift,
    ) === at,
).map(({ chord }) => chord);

/** What this press does, or `undefined` when nothing is bound to it. */
export const actionForCode = (
  mode: BindingMode,
  code: string,
  shift: boolean,
): WindowAction | undefined =>
  BINDINGS.find(
    (binding) =>
      binding.mode === mode && binding.code === code && binding.shift === shift,
  )?.action;

/**
 * The same, for a press the host hands back rather than one the page heard.
 *
 * A `shortcut` message carries the evdev keycode it was claimed with, because
 * the page is not what received it — a `<webview>` had the keyboard and the
 * browser process is the only layer above one.
 */
export const actionForKeycode = (
  mode: BindingMode,
  keycode: number,
  shift: boolean,
): WindowAction | undefined =>
  BINDINGS.find(
    (binding) =>
      binding.mode === mode &&
      binding.chord.keycode === keycode &&
      binding.shift === shift,
  )?.action;
