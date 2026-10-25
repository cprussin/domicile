# @domicile-desktop/sdk

## 1.1.0

### Minor Changes

- 56e1c22: File picker polish:
  
  - New folder button, and a Hidden files toggle (Ctrl+H).
  - The listing updates when the folder changes.
  - A path box (Ctrl+L, or the pencil button). The save name box no longer walks a `/`.
  - No key help in the sidebar; full-size sidebar buttons.
  - Portal labels drop GTK's `_` access key marks ("_Save" shows as "Save").
  - `System.createDir` (`create_dir`) makes a directory. `FileRequest.list` is replaced by `FileRequest.folders` (`systemFolders` in `@domicile-desktop/component-library/folders`).
- e42226f: `theme.force_dark` names sites, such as `mail.google.com`, that the browser draws dark with Chromium's automatic dark mode while the theme is dark, for sites with no dark theme of their own.
- 35b8470: The Google Messages item counts unread conversations read from the page, including ones that were unread before the desktop started, rather than counting its notifications. `<webview>` gains `countMatches(selector)`, which counts the elements in its page that match a CSS selector.
- 6730912: A browser window hidden behind a tab can be screenshotted, previewed and shared: the engine lists it as `isCaptured` while a capture runs, and manganese keeps it laid out under the shown tab. The screenshot and share pickers keep their size when a pick shows a preview. A shared screen's cursor reaches consumers that read it as metadata, such as Chrome.
- 57b5b1f: A watch's and a D-Bus match's `items` are `Listened<T>`: `Listened.Heard(item)`, or `Listened.Missed()` after a compositor restart, when changes in between were not heard. The battery, Bluetooth, network, tray menu and icon theme readers read again then.
- 93f015d: A page can ask for window management, local fonts, idle detection and automatic downloads. The shell asks the user, and Settings and the site panel show each.
- bbf849b: A client can ask to be laid out at a named place in the shell's page (`domicile_anchor_v1`). Shells read it as `DomicileWindow.anchor`.
- 3bb9bd5: A download's file picker starts in the download folder (`XDG_DOWNLOAD_DIR`). The file chooser event has `currentFolder`.
- 52a1d65: The screenshot and screen share pickers draw a window that is not on screen, such as a tab behind another, in place of the desk when it is picked. `System.previewWindow` draws one, through the compositor's new `preview_window` system call.
- 3e5b976: The print dialog labels every option and saves to PDF: pick "Save to PDF" as the destination, then where to save it.
- 9fd298a: The screen share picker offers browser windows, streaming the page alone, and previews each source on the desk. The screenshot picker shows the same preview tiles.
- ee1cc17: `<webview partition="persist:name">` gives a page storage of its own, kept on disk; any other name keeps it in memory. `openBrowserWindow(url, partition)` opens a window in one, listed with its `partition`. A page's own navigation fires a cancelable `domicile-will-navigate` first.

### Patch Changes

- a88ce23: The engine is a workspace package: its shell tests run in `test:shell`, and its checks against a built tree in `test:engine`.
- 2a87739: The screenshot and screen cast pickers take a part of a window that is not on screen, dragged over its preview.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.

## 1.0.0

### Major Changes

- 2056529: The first release.
