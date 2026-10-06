import type { DomicileFilePreview } from "@domicile-desktop/sdk/domicile-host";
import {
  FilePreview,
  FilePreviewKind,
  filePreviewKindSchema,
} from "@domicile-desktop/sdk/file-preview";

/**
 * Converts the host's preview of a path to the preview its `kind` names.
 *
 * Parses `kind` because the engine and this shell ship separately; an unknown
 * kind should throw, not draw an empty preview.
 */
export const previewOf = (answer: DomicileFilePreview): FilePreview => {
  const kind = filePreviewKindSchema.parse(answer.kind);
  switch (kind) {
    case FilePreviewKind.Text: {
      return FilePreview.Text(answer.text);
    }
    case FilePreviewKind.Directory: {
      return FilePreview.Directory(answer.entries);
    }
    case FilePreviewKind.Audio: {
      return FilePreview.Audio({
        album: said(answer.album),
        artist: said(answer.artist),
        cover: said(answer.cover),
        duration: answer.duration,
        title: said(answer.title),
      });
    }
    case FilePreviewKind.Binary: {
      return FilePreview.Binary();
    }
    case FilePreviewKind.Unreadable: {
      return FilePreview.Unreadable();
    }
  }
};

/** A tag, or `undefined` for the engine's empty string (no tag). */
const said = (tag: string): string | undefined =>
  tag === "" ? undefined : tag;
