import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";

import { Axis, Direction } from "../window-management/direction";
import { Layout } from "../window-management/tree/node";
import type { WindowAction as Action } from "../window-management/window-state";
import { WindowAction } from "../window-management/window-state";
import { parseCommand } from "./command";

/** Parse a command as written after `send-shell`. */
const parsing = (command: string) => parseCommand(command.split(" "));

describe("parseCommand", () => {
  it.each<readonly [string, Action]>([
    ["kill", WindowAction.WindowKilled()],
    ["lock", WindowAction.DeskLocked()],
    ["launcher", WindowAction.LauncherToggled()],
    ["clipboard", WindowAction.ClipboardToggled()],
    ["screenshot", WindowAction.ScreenshotTaken()],
    ["focus left", WindowAction.FocusStepped(Direction.Left)],
    ["focus right", WindowAction.FocusStepped(Direction.Right)],
    ["focus up", WindowAction.FocusStepped(Direction.Up)],
    ["focus down", WindowAction.FocusStepped(Direction.Down)],
    ["focus parent", WindowAction.ParentFocused()],
    ["focus child", WindowAction.ChildFocused()],
    ["focus mode_toggle", WindowAction.ModeSwapped()],
    ["move left", WindowAction.WindowStepped(Direction.Left)],
    ["move down", WindowAction.WindowStepped(Direction.Down)],
    ["move scratchpad", WindowAction.WindowSentToScratchpad()],
    [
      "move container to workspace 10",
      WindowAction.WindowSentToWorkspace("10"),
    ],
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
    ["workspace 1", WindowAction.WorkspaceSelected("1")],
    ["resize grow up", WindowAction.WindowGrown(Direction.Up)],
    ["resize grow right", WindowAction.WindowGrown(Direction.Right)],
    ["exec kitty --hold", WindowAction.CommandExecuted(["kitty", "--hold"])],
  ])("reads `%s` as sway does", (command, action) => {
    expect(parsing(command)).toStrictEqual(Ok(action));
  });

  it("refuses `exec` with nothing to run", () => {
    expect(parseCommand(["exec"])).toStrictEqual(
      Err("manganese: `exec` names nothing to run"),
    );
  });

  it.each([
    // Unknown verb.
    "terminal",
    // Unknown argument.
    "focus sideways",
    // Workspace out of range.
    "workspace 11",
    // Extra word.
    "kill now",
  ])("refuses `%s`, naming it", (command) => {
    expect(parsing(command)).toStrictEqual(
      Err(`manganese: no command \`${command}\``),
    );
  });
});
