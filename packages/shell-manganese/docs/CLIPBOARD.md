# The clipboard

**Meta+Shift+V** opens the clipboard history, newest first. Choosing a row
makes it the current selection. Source: `src/clipboard/`.

## Why

A Wayland selection lives in the client that copied it. Closing that client
empties the clipboard. When you pick a row, the compositor serves the paste,
so the copy outlives the client that copied it.

## How it works

- The compositor reads each new selection over a pipe and keeps the last 32,
  up to 128 MiB in all. A repeat moves to the top. See
  `domicile_host::clipboard`, tested in `packages/domicile-host/tests/clipboard.rs`.
- The compositor pushes the history to the page, so the panel is current when
  it opens.
- A row is an id and a short preview. The full copy stays in the compositor;
  `copyClipboardEntry` takes the id. This limits how much of a copied secret
  reaches the page.
- Text and images. A copy keeps its text and one image (PNG if offered, else
  the first `image/` type). An image-only row reads `Image, 1920 × 1080`, or
  `Image (image/webp)` when it is not a PNG. Selections with neither (file
  drags) are skipped.
- Memory only. Nothing is written to disk.
- The clipboard only. The primary selection (highlighted text) stays out of
  the history, so every highlight does not bury what was copied.
- An empty history shows a message.

## Clipboard managers

- The compositor serves `ext-data-control-v1` and `zwlr_data_control_v1`, so
  clipboard managers, `wl-copy` and `wl-paste` work with no window focused.
  Sandboxed clients are not offered them
  ([PORTALS.md](/docs/PORTALS.md#sandboxed-clients)).
- Both selections. A data-control copy enters the history like any other, and
  a restored row is what data-control clients read.
- Tested in `packages/domicile-compositor/tests/selection.rs` and
  `scripts/e2e-data-control.sh`.

## Browser windows

- On a tty, the engine uses the compositor's clipboard
  (`ui/ozone/platform/drm/domicile/drm_clipboard.h` in the fork), so browser
  windows and clients share one clipboard, text and images.
- In a nested run, the browser uses the host session's clipboard instead.
  `ROADMAP.md` tracks this gap.
