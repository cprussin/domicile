import type { ClipboardEntry } from "@domicile-desktop/sdk/desktop/clipboard";

/** What a copy holds, for its row's glyph. */
export enum CopyKind {
  Image,
  Link,
  Text,
}

/** Schemes a copied address opens in a browser with. */
const WEB = new Set(["http:", "https:"]);

/** A copy's kind: an image, a lone web address, or other text. */
export const kindOf = ({
  image,
  preview,
}: Pick<ClipboardEntry, "image" | "preview">): CopyKind => {
  if (image) {
    return CopyKind.Image;
  } else {
    const trimmed = preview.trim();
    return !/\s/.test(trimmed) &&
      URL.canParse(trimmed) &&
      WEB.has(new URL(trimmed).protocol)
      ? CopyKind.Link
      : CopyKind.Text;
  }
};
