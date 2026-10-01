// What a key the config binds does, as a shell's page holds it.
//
// Its own module for `file-preview.ts`'s reason: `host-message.ts` builds one
// out of the compositor's `shell_config`, and `bind-keys.ts` switches on it.
// The wire's words are `send_shell` and `mode`; this is the memory form, and
// `host-message.ts` is the one place the two meet.

/** Which of the two things a binding can do. */
export enum KeyActionKind {
  SendShell,
  Mode,
}

export const KeyAction = {
  /**
   * `mode <name>`: read the keys in another binding mode. The SDK answers this
   * itself — a shell is told the mode changed, never asked to change it.
   */
  Mode: (name: string) => ({ kind: KeyActionKind.Mode as const, name }),
  /**
   * `send-shell <word>...`: a command for the shell, as the words after
   * `send-shell`. What they mean is the shell's vocabulary, not the SDK's.
   */
  SendShell: (args: readonly string[]) => ({
    args,
    kind: KeyActionKind.SendShell as const,
  }),
};

export type KeyAction = ReturnType<(typeof KeyAction)[keyof typeof KeyAction]>;
