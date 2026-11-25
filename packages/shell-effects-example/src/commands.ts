// The shell's commands, which its keys send and `domicile send-shell` sends
// too, so a script or an agent drives it as a person does.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { KeyAction } from "@domicile-desktop/sdk/key-action";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import type { ShellCommandHelp } from "@domicile-desktop/sdk/shell-command";

import type { CloseEffect } from "./close";
import { CLOSE_EFFECTS } from "./close";

/** What a command asks the shell to do. */
export type Command =
  | { readonly kind: "workspace"; readonly index: number }
  | { readonly kind: "close-effect"; readonly effect: CloseEffect }
  | { readonly kind: "kill" };

/** What `domicile list-shell-commands` prints for this shell. */
export const commandHelp = (
  workspaces: number,
): readonly ShellCommandHelp[] => [
  {
    description: "Turn the cube to a workspace.",
    usage: `workspace 1-${workspaces.toString()}`,
  },
  {
    description: "Pick the effect windows close with, as the bar does.",
    usage: `close-effect ${CLOSE_EFFECTS.join("|")}`,
  },
  { description: "Close the focused window.", usage: "kill" },
];

/** Meta+1 and on turn the cube, Meta+Shift+Q closes, Meta+Return opens kitty. */
export const keybindings = (workspaces: number): ShellKeybindings => ({
  keybindings: {
    ...Object.fromEntries(
      Array.from({ length: workspaces }, (_, index) => [
        `Meta+${(index + 1).toString()}`,
        KeyAction.SendShell(["workspace", (index + 1).toString()]),
      ]),
    ),
    "Meta+Return": KeyAction.Exec(["kitty"]),
    "Meta+Shift+q": KeyAction.SendShell(["kill"]),
  },
});

/** Reads `words`, or says why the shell runs no such command. */
export const parseCommand = (
  words: readonly string[],
  workspaces: number,
): Result<Command, string> => {
  const [verb, argument, ...rest] = words;
  if (rest.length > 0) {
    return Err(`too many words: ${words.join(" ")}`);
  }
  switch (verb) {
    case "workspace": {
      const index = Number(argument) - 1;
      return Number.isInteger(index) && index >= 0 && index < workspaces
        ? Ok({ index, kind: "workspace" })
        : Err(
            `no workspace ${String(argument)}: there are 1 to ${workspaces.toString()}`,
          );
    }
    case "close-effect": {
      const effect = CLOSE_EFFECTS.find((known) => known === argument);
      return effect === undefined
        ? Err(
            `no close effect ${String(argument)}: there are ${CLOSE_EFFECTS.join(", ")}`,
          )
        : Ok({ effect, kind: "close-effect" });
    }
    case "kill":
      return argument === undefined
        ? Ok({ kind: "kill" })
        : Err("kill takes no argument");
    default:
      return Err(`no command ${words.join(" ")}`);
  }
};
