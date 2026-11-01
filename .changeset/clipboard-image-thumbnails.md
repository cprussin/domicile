---
"domicile": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-clipboard": minor
---

Clipboard history rows show a thumbnail of a copied image: `DomicileClipboardEntry.thumbnail` is a small PNG `data:` URL (empty for none; the SDK gives `undefined`), and `RowTile` takes a `picture` to draw in place of its glyph.
