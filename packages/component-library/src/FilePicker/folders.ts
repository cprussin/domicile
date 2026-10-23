// The folders `FilePicker` browses, and the system calls behind them.

import type { Result } from "@cprussin/option-result";
import type { System, SystemError } from "@domicile-desktop/sdk/system";

import { listDirectory } from "./list-directory";

/** What the picker does to folders, by absolute path. */
export type Folders = {
  /** Creates the directory at `path`; fails if anything has its name. */
  create: (path: string) => Promise<Result<"created", SystemError>>;
  /**
   * Lists the directory at `path`; subdirectory names end in `/`. Rejects
   * with a `NotReadableError` `DOMException` if it is unreadable.
   */
  list: (path: string) => Promise<readonly string[]>;
  /**
   * Calls `changed` after each change to the entries of the directory at
   * `path`, until the returned function is called.
   */
  watch: (path: string, changed: () => void) => () => void;
};

/** {@link Folders} through the compositor's system calls. */
export const systemFolders = (system: System): Folders => ({
  create: (path) => system.createDir(path),
  list: (path) => listDirectory(system, path),
  watch: (path, changed) => watchDirectory(system, path, changed),
});

/**
 * Calls `changed` for each change heard, and for changes missed while the
 * compositor restarted. Logs a watch that cannot start: the picker still
 * works, without live updates.
 */
const watchDirectory = (
  system: System,
  path: string,
  changed: () => void,
): (() => void) => {
  const watching: Watching = {
    stop: undefined,
    stopped: false,
  };
  follow(system, path, watching, changed).catch((error: unknown) => {
    // biome-ignore lint/suspicious/noConsole: reports a watch that broke
    console.error("The file picker's directory watch broke", error);
  });
  return () => {
    watching.stopped = true;
    watching.stop?.();
  };
};

type Watching = { stop: (() => void) | undefined; stopped: boolean };

/** Starts the watch, then calls `changed` for each item until it ends. */
const follow = async (
  system: System,
  path: string,
  watching: Watching,
  changed: () => void,
): Promise<void> => {
  const watch = (await system.watch(path)).match({
    Err: (error) => {
      // biome-ignore lint/suspicious/noConsole: reports a watch that could not start
      console.error("The file picker could not watch a directory", error);
      return undefined;
    },
    Ok: (started) => started,
  });
  if (watch !== undefined) {
    if (watching.stopped) {
      watch.stop();
    } else {
      watching.stop = watch.stop;
      for await (const _ of watch.items) {
        changed();
      }
    }
  }
};
