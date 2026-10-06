// A page's file chooser request, parsed from the engine's event into the
// `FilePicker`'s `FileRequest`.
//
// The engine ships separately, so its mode string is external data (see
// `WEBVIEW_FILE_CHOOSER_MODES`). It is parsed only here, and unknown modes
// throw rather than show the wrong picker.

import type { FileRequest } from "@domicile-desktop/component-library/file-request";
import { ChooserMode } from "@domicile-desktop/component-library/file-request";
import { WEBVIEW_FILE_CHOOSER_MODES } from "@domicile-desktop/sdk/webview-element";
import { z } from "zod";

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

/** The `FileRequest` for a page's file chooser event. */
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
