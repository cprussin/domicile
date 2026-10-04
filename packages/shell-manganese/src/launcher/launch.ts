// The action for a chosen launcher row: run an app, open a file, or browse to
// a URL. `choices.ts` builds the rows.

/** The kind of launch. */
export enum LaunchKind {
  Ran,
  Opened,
  Browsed,
}

export const Launch = {
  /** Open `url` in a browser window on the desktop. */
  Browsed: (url: string) => ({ kind: LaunchKind.Browsed as const, url }),
  /**
   * Open `path` with the user's default application.
   *
   * Relative to home (as the host reports paths) or absolute. See
   * `open-command.ts`.
   */
  Opened: (path: string) => ({ kind: LaunchKind.Opened as const, path }),
  /** Run a desktop entry's argv, as the host parsed it. */
  Ran: (command: readonly string[]) => ({
    command,
    kind: LaunchKind.Ran as const,
  }),
};

export type Launch = ReturnType<(typeof Launch)[keyof typeof Launch]>;
