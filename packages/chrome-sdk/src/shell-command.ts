// The commands `domicile send-shell` sends a shell, and how a shell describes
// the ones it runs for `domicile list-shell-commands`. See
// docs/architecture/KEYBINDINGS.md.

/** One command a shell runs, as `domicile list-shell-commands` prints it. */
export type ShellCommandHelp = {
  /** Its words, such as `focus left|right|up|down` or `workspace <name>`. */
  readonly usage: string;
  /** What it does, in a sentence. */
  readonly description: string;
};

/** A command `domicile send-shell` sent, for the page to run and answer. */
export type ShellCommand = {
  /** The words after `send-shell`. */
  readonly words: readonly string[];
  /** Its number, which `answerShellCommand` names. */
  readonly sent: number;
};
