// Typed builders for manganese's commands, and the default keybindings.
//
// Each builder produces the `send-shell` words `command.ts` parses, so a
// binding in a shell's options is type-checked where it is written.

import { KeyAction } from "@domicile-desktop/sdk/key-action";
import type {
  ModeKeybindings,
  ShellKeybindings,
} from "@domicile-desktop/sdk/own-keybindings";

/** A direction. */
export type Way = "left" | "down" | "up" | "right";

/** A manganese command, as the words after `send-shell`. */
const command = (...words: readonly string[]) => KeyAction.SendShell(words);

/** Run `argv` directly, without a shell. */
export const exec = (...argv: readonly string[]) => command("exec", ...argv);
/** Close the focused window. */
export const kill = () => command("kill");
/** Lock the desk. */
export const lock = () => command("lock");
/** Toggle the launcher. */
export const launcher = () => command("launcher");
/** Toggle the clipboard history. */
export const clipboard = () => command("clipboard");
/** Take a screenshot, picking the area in a dialog. */
export const screenshot = () => command("screenshot");
/** Move the focus, or focus the parent or child container. */
export const focus = (to: Way | "parent" | "child" | "mode_toggle") =>
  command("focus", to);
/** Move the window, or send it to the scratchpad. */
export const move = (to: Way | "scratchpad") => command("move", to);
/** Send the window to workspace `1` to `10` without following it. */
export const moveToWorkspace = (name: string) =>
  command("move", "container", "to", "workspace", name);
/** Go to a workspace, `1` to `10`. */
export const workspace = (name: string) => command("workspace", name);
/** Wrap the focused window in a new container. */
export const split = (axis: "h" | "v") => command("split", axis);
/** Set the layout of the focused container. */
export const layout = (as: "stacking" | "tabbed" | "toggle split") =>
  command("layout", ...as.split(" "));
/** Toggle fullscreen, across every screen with `global`. */
export const fullscreen = (global = false) =>
  global
    ? command("fullscreen", "toggle", "global")
    : command("fullscreen", "toggle");
/** Toggle floating. */
export const floating = () => command("floating", "toggle");
/** Show the next scratchpad window, or hide the shown one. */
export const scratchpad = () => command("scratchpad", "show");
/** Grow the window in a direction, shrinking its neighbor. */
export const grow = (way: Way) => command("resize", "grow", way);
/** Enter a binding mode. */
export const mode = (name: string) => KeyAction.Mode(name);

/** Vim keys and arrow keys, by direction. */
const WAYS: readonly (readonly [Way, readonly string[]])[] = [
  ["left", ["h", "Left"]],
  ["down", ["j", "Down"]],
  ["up", ["k", "Up"]],
  ["right", ["l", "Right"]],
];

/** Bind `Meta+<held><key>` to `each` for every direction key. */
const everyWay = (
  held: string,
  each: (way: Way) => KeyAction,
): ModeKeybindings =>
  Object.fromEntries(
    WAYS.flatMap(([way, keys]) =>
      keys.map((key) => [`Meta+${held}${key}`, each(way)] as const),
    ),
  );

/** Bind `Meta+<held><digit>` to `each` for workspaces 1 to 10 (keys 1 to 0). */
const everyWorkspace = (
  held: string,
  each: (name: string) => KeyAction,
): ModeKeybindings =>
  Object.fromEntries(
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((digit, at) => [
      `Meta+${held}${digit}`,
      each(String(at + 1)),
    ]),
  );

/**
 * Default bindings for mode `default`: sway's, on Meta. Spread into your own
 * table to override individual keys.
 */
export const DEFAULT_KEYBINDINGS: ModeKeybindings = {
  "Meta+a": focus("parent"),
  "Meta+b": split("h"),
  "Meta+d": launcher(),
  "Meta+e": layout("toggle split"),
  "Meta+f": fullscreen(),
  "Meta+minus": scratchpad(),
  "Meta+r": mode("resize"),
  "Meta+Shift+a": focus("child"),
  "Meta+Shift+f": fullscreen(true),
  "Meta+Shift+minus": move("scratchpad"),
  "Meta+Shift+q": kill(),
  "Meta+Shift+Return": lock(),
  "Meta+Shift+Tab": floating(),
  "Meta+Shift+v": clipboard(),
  "Meta+s": layout("stacking"),
  "Meta+space": launcher(),
  "Meta+Tab": focus("mode_toggle"),
  "Meta+v": split("v"),
  "Meta+w": layout("tabbed"),
  Print: screenshot(),
  ...everyWay("", focus),
  ...everyWay("Shift+", move),
  ...everyWorkspace("", workspace),
  ...everyWorkspace("Shift+", moveToWorkspace),
};

/** Default extra modes: `resize`, entered with `Meta+r`. */
export const DEFAULT_MODES: NonNullable<ShellKeybindings["modes"]> = {
  resize: {
    "Meta+Escape": mode("default"),
    "Meta+Return": mode("default"),
    ...everyWay("", grow),
  },
};
