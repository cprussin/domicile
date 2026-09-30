// What a page is waiting on when it needs a file picked, read off the engine's
// event.
//
// THE MODE IS PARSED HERE AND NOWHERE ELSE. The engine and this shell ship
// apart, so the word the event carries is external data — see
// `WEBVIEW_FILE_CHOOSER_MODES` — and a picker drawn for a mode it misread
// answers a question nobody asked: a folder where the page wanted one file, or
// a path to read where it wanted one to write.

import { WEBVIEW_FILE_CHOOSER_MODES } from "@domicile/chrome-sdk/webview-element";
import { z } from "zod";

/** What the page asks for — see `WEBVIEW_FILE_CHOOSER_MODES`. */
export enum ChooserMode {
  Open,
  OpenMultiple,
  OpenFolder,
  Save,
}

/**
 * The engine's word for a mode, mapped to this shell's. Throws on one it
 * cannot name, which an engine newer than this shell can send.
 */
const modeSchema = z.enum(WEBVIEW_FILE_CHOOSER_MODES).transform((mode) => {
  switch (mode) {
    case "open": {
      return ChooserMode.Open;
    }
    case "open-multiple": {
      return ChooserMode.OpenMultiple;
    }
    case "open-folder": {
      return ChooserMode.OpenFolder;
    }
    case "save": {
      return ChooserMode.Save;
    }
  }
});

/**
 * A page waiting for a file: what it asks for, and the two ways to answer.
 *
 * Paths are absolute, or relative to home — the vocabulary `searchFiles`
 * answers in, where `""` is home. See `DomicileFileChooserEvent`.
 */
export type FileRequest = {
  /** Extensions the page will take, lower case and dotless; empty is any. */
  accept: readonly string[];
  cancel: () => void;
  choose: (paths: readonly string[]) => void;
  /**
   * What is in the directory at `path`, a directory's ending in `/` — how the
   * picker reaches what the index never found. Rejects for one the browser
   * cannot read.
   */
  list: (path: string) => Promise<readonly string[]>;
  mode: ChooserMode;
  /** The name the page suggests for a save; `""` otherwise. */
  suggestedName: string;
};

export const fileRequestOf = (
  event: DomicileFileChooserEvent,
): FileRequest => ({
  accept: event.accept,
  cancel: () => {
    event.cancel();
  },
  choose: (paths) => {
    event.choose(paths);
  },
  list: (path) => event.list(path),
  mode: modeSchema.parse(event.mode),
  suggestedName: event.suggestedName,
});
