// A page's file chooser request, parsed from the engine's event.
//
// The engine ships separately, so its mode string is external data (see
// `WEBVIEW_FILE_CHOOSER_MODES`). It is parsed only here, and unknown modes
// throw rather than show the wrong picker.

import { WEBVIEW_FILE_CHOOSER_MODES } from "@domicile-desktop/sdk/webview-element";
import { z } from "zod";

/** The kind of file chooser. See `WEBVIEW_FILE_CHOOSER_MODES`. */
export enum ChooserMode {
  Open,
  OpenMultiple,
  OpenFolder,
  Save,
}

/**
 * Maps the engine's mode string to a {@link ChooserMode}. Throws on an unknown
 * mode, which a newer engine could send.
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
 * A pending file chooser request and its callbacks.
 *
 * Answers are absolute paths. See `DomicileFileChooserEvent`.
 */
export type FileRequest = {
  /** Accepted extensions, lowercase and without the dot; empty accepts any. */
  accept: readonly string[];
  cancel: () => void;
  choose: (paths: readonly string[]) => void;
  /** The absolute home directory, where the picker starts. */
  home: string;
  /**
   * Lists the directory at `path`; subdirectory names end in `/`. Rejects if
   * it is unreadable.
   */
  list: (path: string) => Promise<readonly string[]>;
  mode: ChooserMode;
  /** The suggested file name for a save; `""` otherwise. */
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
  home: event.home,
  list: (path) => event.list(path),
  mode: modeSchema.parse(event.mode),
  suggestedName: event.suggestedName,
});
