// The action a keybinding runs: a shell command or a binding mode change.

/** The kind of action a binding runs. */
export enum KeyActionKind {
  SendShell,
  Mode,
}

export const KeyAction = {
  /**
   * Switch to another binding mode. The SDK handles this itself and tells the
   * shell the mode changed.
   */
  Mode: (name: string) => ({ kind: KeyActionKind.Mode as const, name }),
  /**
   * A command for the shell, as the arguments `domicile send-shell` would
   * pass. The shell defines what they mean.
   */
  SendShell: (args: readonly string[]) => ({
    args,
    kind: KeyActionKind.SendShell as const,
  }),
};

export type KeyAction = ReturnType<(typeof KeyAction)[keyof typeof KeyAction]>;
