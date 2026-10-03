// What a key of manganese's can do, as a binding names it, and the keys a
// desktop gets without binding any.
//
// Each is the `send-shell` words `command.ts` reads, built rather than typed,
// so a binding in a shell's props is checked where it is written.

import { KeyAction } from "@domicile-desktop/sdk/key-action";
import type {
  ModeKeybindings,
  ShellKeybindings,
} from "@domicile-desktop/sdk/own-keybindings";

/** A way a window or the focus can go. */
export type Way = "left" | "down" | "up" | "right";

/** A command for manganese, as the words after `send-shell`. */
const command = (...words: readonly string[]) => KeyAction.SendShell(words);

/** Launch a terminal. */
export const terminal = () => command("terminal");
/** Close the window being worked in. */
export const kill = () => command("kill");
/** Lock the desk. */
export const lock = () => command("lock");
/** Open the launcher, or put it away. */
export const launcher = () => command("launcher");
/** Open the clipboard's history, or put it away. */
export const clipboard = () => command("clipboard");
/** Move the focus, or point the commands at the container around it. */
export const focus = (to: Way | "parent" | "child" | "mode_toggle") =>
  command("focus", to);
/** Move the window, or hide it in the scratchpad. */
export const move = (to: Way | "scratchpad") => command("move", to);
/** Send the window to a workspace, `1` to `10`, and stay. */
export const moveToWorkspace = (name: string) =>
  command("move", "container", "to", "workspace", name);
/** Go to a workspace, `1` to `10`. */
export const workspace = (name: string) => command("workspace", name);
/** Wrap the focus in a container of one. */
export const split = (axis: "h" | "v") => command("split", axis);
/** Lay out the container the focus is in. */
export const layout = (as: "stacking" | "tabbed" | "toggle split") =>
  command("layout", ...as.split(" "));
/** Fill the screen, or every screen with `global`, with the window. */
export const fullscreen = (global = false) =>
  global
    ? command("fullscreen", "toggle", "global")
    : command("fullscreen", "toggle");
/** Take the window out of the tiling, or put it back. */
export const floating = () => command("floating", "toggle");
/** Bring the last window hidden in the scratchpad back. */
export const scratchpad = () => command("scratchpad", "show");
/** Grow the window that way; the neighbor gives way. */
export const grow = (way: Way) => command("resize", "grow", way);
/** Read the keys in another binding mode. */
export const mode = (name: string) => KeyAction.Mode(name);

/** The vim keys and the arrows, by the way each goes. */
const WAYS: readonly (readonly [Way, readonly string[]])[] = [
  ["left", ["h", "Left"]],
  ["down", ["j", "Down"]],
  ["up", ["k", "Up"]],
  ["right", ["l", "Right"]],
];

/** `each` for every way's two keys, as `Meta+<key>` with `held` too. */
const everyWay = (
  held: string,
  each: (way: Way) => KeyAction,
): ModeKeybindings =>
  Object.fromEntries(
    WAYS.flatMap(([way, keys]) =>
      keys.map((key) => [`Meta+${held}${key}`, each(way)] as const),
    ),
  );

/** Workspaces 1 to 10, on the digits 1 to 0, as `Meta+<digit>` with `held`. */
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
 * Mode `default`, as a desktop gets it: sway's keys, on Meta. Spread it into a
 * table of your own to keep it and change a key.
 */
export const DEFAULT_KEYBINDINGS: ModeKeybindings = {
  "Meta+a": focus("parent"),
  "Meta+b": split("h"),
  "Meta+d": launcher(),
  "Meta+e": layout("toggle split"),
  "Meta+f": fullscreen(),
  "Meta+minus": scratchpad(),
  "Meta+Return": terminal(),
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
  ...everyWay("", focus),
  ...everyWay("Shift+", move),
  ...everyWorkspace("", workspace),
  ...everyWorkspace("Shift+", moveToWorkspace),
};

/** The modes a desktop gets: `resize`, which `Meta+r` enters. */
export const DEFAULT_MODES: NonNullable<ShellKeybindings["modes"]> = {
  resize: {
    "Meta+Escape": mode("default"),
    "Meta+Return": mode("default"),
    ...everyWay("", grow),
  },
};
