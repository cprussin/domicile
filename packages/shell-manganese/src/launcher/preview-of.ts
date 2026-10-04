import type { DomicileFilePreview } from "@domicile-desktop/sdk/domicile-host";
import {
  FilePreview,
  FilePreviewKind,
  filePreviewKindSchema,
} from "@domicile-desktop/sdk/file-preview";

/**
 * What the host said a path holds, as the one preview its `kind` carries.
 *
 * The kind is parsed rather than trusted: the engine and this shell ship
 * apart, and a kind this shell cannot name would otherwise draw as an empty
 * preview with nothing said.
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

/** A tag the engine carries as empty, which is a song that did not say it. */
const said = (tag: string): string | undefined =>
  tag === "" ? undefined : tag;
