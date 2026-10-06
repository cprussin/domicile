// What `FilePicker` asks for and how it answers, independent of who asked.

/** The kind of file chooser. */
export enum ChooserMode {
  Open,
  OpenMultiple,
  OpenFolder,
  Save,
}

/** A named group of accepted extensions, such as "Images". */
export type FileFilter = {
  /** Lowercase and without the dot. */
  extensions: readonly string[];
  name: string;
};

/**
 * A pending file chooser request and its callbacks.
 *
 * Answers are absolute paths.
 */
export type FileRequest = {
  /** Accepted extensions, lowercase and without the dot; empty accepts any. */
  accept: readonly string[];
  cancel: () => void;
  choose: (paths: readonly string[]) => void;
  /** The absolute folder to start in; the home if unset. */
  currentFolder?: string | undefined;
  /**
   * Groups the user switches between, in place of `accept`. The first
   * applies until another is picked.
   */
  filters?: readonly FileFilter[] | undefined;
  /** The absolute home directory. */
  home: string;
  /**
   * Lists the directory at `path`; subdirectory names end in `/`. Rejects
   * with a `NotReadableError` `DOMException` if it is unreadable.
   */
  list: (path: string) => Promise<readonly string[]>;
  mode: ChooserMode;
  /** The suggested file name for a save; `""` otherwise. */
  suggestedName: string;
  /** The dialog's title; one for `mode` if unset. */
  title?: string | undefined;
};
