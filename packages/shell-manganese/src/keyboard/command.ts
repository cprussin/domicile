// What a key the config binds asks the desktop to do.
//
// The compositor's config binds a chord to `send-shell <words>`, and the SDK
// hands the words here. **They are sway's commands, spelled as sway spells
// them** wherever sway has the command — `focus left`, `move container to
// workspace 2`, `layout tabbed` — so a sway user's bindings carry over by
// copying the line. The few sway has no word for are manganese's own:
// `terminal`, `lock`, `launcher`, `clipboard` and `resize grow <direction>`.
//
// A command this desktop does not know is the user's config, not a bug here,
// so it is an `Err` naming it rather than a throw.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import { Axis, Direction } from "../window-management/direction";
import { Layout } from "../window-management/tree/node";
import type { WindowAction as Action } from "../window-management/window-state";
import { WindowAction, WORKSPACES } from "../window-management/window-state";

/** The four ways a window or the focus can go, by sway's words for them. */
const DIRECTIONS: readonly (readonly [word: string, way: Direction])[] = [
  ["left", Direction.Left],
  ["down", Direction.Down],
  ["up", Direction.Up],
  ["right", Direction.Right],
];

/** One command: its words, and what they ask for. */
type Command = readonly [words: string, action: Action];

/** Every command this desktop knows, by its words. */
const COMMANDS: ReadonlyMap<string, Action> = new Map<string, Action>([
  ["terminal", WindowAction.TerminalLaunched()],
  ["kill", WindowAction.WindowKilled()],
  // Not sway's, which has no lock.
  ["lock", WindowAction.DeskLocked()],
  // A toggle, because the same press is what you reach for to open it and to
  // give up on it. Escape and the backdrop close it too, and those arrive from
  // the dialog rather than from here — see `launcher/Launcher.tsx`.
  ["launcher", WindowAction.LauncherToggled()],
  // The clipboard's history, a toggle for the launcher's reason.
  ["clipboard", WindowAction.ClipboardToggled()],
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

/**
 * The action the words after `send-shell` name, or an `Err` saying which
 * words named nothing.
 */
export const parseCommand = (
  args: readonly string[],
): Result<Action, string> => {
  const command = args.join(" ");
  const action = COMMANDS.get(command);
  return action === undefined
    ? Err(`manganese: no command \`${command}\``)
    : Ok(action);
};
