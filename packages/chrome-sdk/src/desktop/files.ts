// Files and directories on the machine running the desktop, which the
// compositor reads and writes for the shell. See docs/SHELL-SYSTEM-ACCESS.md.

import type { DomicileFileSearch, DomicileHost } from "../domicile-host";
import type { System } from "./system-calls";

export type FileSearch = DomicileFileSearch;

/** A relative path starts at the home. Refused while the desktop is locked. */
export type Files = {
  read: System["readFile"];
  readText: System["readTextFile"];
  write: System["writeFile"];
  createDir: System["createDir"];
  readDir: System["readDir"];
  stat: System["stat"];
  watch: System["watch"];
  /**
   * What in the compositor's index of the home matches `query`. A newer
   * search rejects the older with an AbortError.
   */
  search: (query: string) => Promise<FileSearch>;
};

export type FileCalls = Pick<
  System,
  | "createDir"
  | "readDir"
  | "readFile"
  | "readTextFile"
  | "stat"
  | "watch"
  | "writeFile"
>;

export const files = (
  host: Pick<DomicileHost, "searchFiles">,
  calls: FileCalls,
): Files => ({
  ...fileCalls(calls),
  search: (query) => host.searchFiles(query),
});

/** The file calls, which an app module has too. */
export const fileCalls = (calls: FileCalls): Omit<Files, "search"> => ({
  createDir: (path) => calls.createDir(path),
  read: (path, range) => calls.readFile(path, range),
  readDir: (path) => calls.readDir(path),
  readText: (path) => calls.readTextFile(path),
  stat: (path) => calls.stat(path),
  watch: (path) => calls.watch(path),
  write: (path, data, options) => calls.writeFile(path, data, options),
});
