// What the launcher does once a row has been chosen: edit a file, or browse
// to a URL. Which rows there are is `choices.ts`'s to decide.

/** Which of the two things the launcher can do with a query. */
export enum LaunchKind {
  Edited,
  Browsed,
}

export const Launch = {
  /** Open `url` in a browser window on the desktop. */
  Browsed: (url: string) => ({ kind: LaunchKind.Browsed as const, url }),
  /**
   * Open `path` in the user's editor.
   *
   * Relative to the home directory, the way the host names what it offers, or
   * absolute for a path outside it. `editor-command.ts` is what turns the two
   * into one command.
   */
  Edited: (path: string) => ({ kind: LaunchKind.Edited as const, path }),
};

export type Launch = ReturnType<(typeof Launch)[keyof typeof Launch]>;
