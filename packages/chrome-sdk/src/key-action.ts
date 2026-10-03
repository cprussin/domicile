// What a key a shell binds does: a command for the shell, or a change of the
// binding mode the keys are read in.
//
// Its own module for `file-preview.ts`'s reason: a shell builds one for each
// of its bindings, and `bind-keys.ts` switches on it.

/** Which of the two things a binding can do. */
export enum KeyActionKind {
  SendShell,
  Mode,
}

export const KeyAction = {
  /**
   * Read the keys in another binding mode. The SDK answers this itself — a
   * shell is told the mode changed, never asked to change it.
   */
  Mode: (name: string) => ({ kind: KeyActionKind.Mode as const, name }),
  /**
   * A command for the shell, as words — the words `domicile send-shell`
   * would carry. What they mean is the shell's vocabulary, not the SDK's.
   */
  SendShell: (args: readonly string[]) => ({
    args,
    kind: KeyActionKind.SendShell as const,
  }),
};

export type KeyAction = ReturnType<(typeof KeyAction)[keyof typeof KeyAction]>;
