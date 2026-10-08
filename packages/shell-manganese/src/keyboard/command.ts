// Parses the words of a `send-shell <words>` binding into a window action.
//
// - Commands use sway's syntax where sway has one (`focus left`, `layout
//   tabbed`), so sway bindings can be copied over. `lock`, `launcher`,
//   `clipboard`, `screenshot` and `resize grow <direction>` are manganese's
//   own.
// - `exec <argv…>` runs the argv directly, not through `sh -c` as sway does.
// - An unknown command is a config error, so it returns an `Err`, not a throw.
//
// See docs/architecture/KEYBINDINGS.md.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import { Axis, Direction } from "../window-management/direction";
import { Layout } from "../window-management/tree/node";
import type { WindowAction as Action } from "../window-management/window-state";
import { WindowAction, WORKSPACES } from "../window-management/window-state";

/** Sway's direction words. */
const DIRECTIONS: readonly (readonly [word: string, way: Direction])[] = [
  ["left", Direction.Left],
  ["down", Direction.Down],
  ["up", Direction.Up],
  ["right", Direction.Right],
];

/** A command's words and its action. */
type Command = readonly [words: string, action: Action];

/** Every known command, by its words. */
const COMMANDS: ReadonlyMap<string, Action> = new Map<string, Action>([
  ["kill", WindowAction.WindowKilled()],
  // Sway has no lock command.
  ["lock", WindowAction.DeskLocked()],
  // A toggle, so the same key opens and closes it. Escape and the backdrop
  // close it from the dialog (see `launcher/Launcher.tsx`).
  ["launcher", WindowAction.LauncherToggled()],
  // Clipboard history; a toggle, like the launcher.
  ["clipboard", WindowAction.ClipboardToggled()],
  // The area is picked in the screenshot dialog.
  ["screenshot", WindowAction.ScreenshotTaken()],
  ...DIRECTIONS.map(
    ([word, way]): Command => [`focus ${word}`, WindowAction.FocusStepped(way)],
  ),
  ["focus parent", WindowAction.ParentFocused()],
  ["focus child", WindowAction.ChildFocused()],
  ["focus mode_toggle", WindowAction.ModeSwapped()],
  ...DIRECTIONS.map(
    ([word, way]): Command => [`move ${word}`, WindowAction.WindowStepped(way)],
  ),
  ["move scratchpad", WindowAction.WindowSentToScratchpad()],
  ["split h", WindowAction.ContainerSplit(Axis.Horizontal)],
  ["split v", WindowAction.ContainerSplit(Axis.Vertical)],
  ["splith", WindowAction.ContainerSplit(Axis.Horizontal)],
  ["splitv", WindowAction.ContainerSplit(Axis.Vertical)],
  ["layout stacking", WindowAction.LayoutSet(Layout.Stacking)],
  ["layout tabbed", WindowAction.LayoutSet(Layout.Tabbed)],
  ["layout toggle split", WindowAction.SplitToggled()],
  ["fullscreen toggle", WindowAction.FullscreenToggled(false)],
  ["fullscreen toggle global", WindowAction.FullscreenToggled(true)],
  ["floating toggle", WindowAction.FloatToggled()],
  ["scratchpad show", WindowAction.ScratchpadShown()],
  ...DIRECTIONS.map(
    ([word, way]): Command => [
      `resize grow ${word}`,
      WindowAction.WindowGrown(way),
    ],
  ),
  ...WORKSPACES.flatMap((name): Command[] => [
    [`workspace ${name}`, WindowAction.WorkspaceSelected(name)],
    [
      `move container to workspace ${name}`,
      WindowAction.WindowSentToWorkspace(name),
    ],
  ]),
]);

/** Parse the words after `send-shell`, or `Err` for an unknown command. */
export const parseCommand = (
  args: readonly string[],
): Result<Action, string> => {
  const [verb, ...argv] = args;
  return verb === "exec" ? parseExec(argv) : parseNamed(args);
};

/** Parse `exec`'s argv, which must not be empty. */
const parseExec = (argv: readonly string[]): Result<Action, string> =>
  argv.length === 0
    ? Err("manganese: `exec` names nothing to run")
    : Ok(WindowAction.CommandExecuted(argv));

/** Look up a command in {@link COMMANDS}. */
const parseNamed = (args: readonly string[]): Result<Action, string> => {
  const command = args.join(" ");
  const action = COMMANDS.get(command);
  return action === undefined
    ? Err(`manganese: no command \`${command}\``)
    : Ok(action);
};
