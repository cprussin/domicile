import type { ConfigDocument, ConfigPath } from "./config-document";
import type { Settings } from "./config-schema";

/** What a settings page reads and changes. */
export type ConfigEditor = {
  settings: Settings;
  /** The config as written, without defaults, for lists edited in place. */
  document: ConfigDocument;
  /** Why the page cannot change anything, or `undefined` if it can. */
  readOnly: string | undefined;
  /**
   * Writes `value` at `path`. `undefined` removes the key, which is how a
   * setting goes back to its default.
   */
  set: (path: ConfigPath, value: unknown) => void;
  /** Reports a value the page refused, or a change that failed. */
  report: Report;
};

/** Reports a failure as a toast titled `title`. */
export type Report = (title: string) => (cause: unknown) => void;

/** What every page of config settings takes. */
export type ConfigPageProps = {
  title: string;
  description: string;
  editor: ConfigEditor;
};
