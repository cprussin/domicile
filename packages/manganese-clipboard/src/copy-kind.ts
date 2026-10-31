/** What a copy holds, for its row's glyph. */
export enum CopyKind {
  Link,
  Text,
}

/** Schemes a copied address opens in a browser with. */
const WEB = new Set(["http:", "https:"]);

/** A copy's kind, from its preview: a lone web address is a link. */
export const kindOf = (preview: string): CopyKind => {
  const trimmed = preview.trim();
  return !/\s/.test(trimmed) &&
    URL.canParse(trimmed) &&
    WEB.has(new URL(trimmed).protocol)
    ? CopyKind.Link
    : CopyKind.Text;
};
