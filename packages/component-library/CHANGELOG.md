# @domicile-desktop/component-library

## 1.1.0

### Minor Changes

- 56e1c22: File picker polish:
  
  - New folder button, and a Hidden files toggle (Ctrl+H).
  - The listing updates when the folder changes.
  - A path box (Ctrl+L, or the pencil button). The save name box no longer walks a `/`.
  - No key help in the sidebar; full-size sidebar buttons.
  - Portal labels drop GTK's `_` access key marks ("_Save" shows as "Save").
  - `System.createDir` (`create_dir`) makes a directory. `FileRequest.list` is replaced by `FileRequest.folders` (`systemFolders` in `@domicile-desktop/component-library/folders`).
- b49fa3a: Add a Google Messages bar item: Messages for web in a panel, with a count of its new messages. Popovers can stay mounted while closed and open from triggers on other bars, and a bar item's panel can keep the keyboard.
- cd02e0e: The volume, microphone and brightness toast is larger, with a big icon, the level as a number and a thick meter. Pressing a key again while it is up updates it in place instead of showing it again. The component library adds `LevelToast`.
- e1205bb: Add `Notice`, a pill that briefly shows a change such as a zoom level or volume, with an optional level meter.
- 52a1d65: The screenshot and screen share pickers draw a window that is not on screen, such as a tab behind another, in place of the desk when it is picked. `System.previewWindow` draws one, through the compositor's new `preview_window` system call.
- 3e5b976: The print dialog labels every option and saves to PDF: pick "Save to PDF" as the destination, then where to save it.
- 9fd298a: The screen share picker offers browser windows, streaming the page alone, and previews each source on the desk. The screenshot picker shows the same preview tiles.
- c4fe915: The screenshot picker lists what to save beside one preview of the desk, which outlines the pick with its size. It fits on the screen, arrow keys move through the list, and a Copy button copies the pick.
- 21b82af: The share picker picks a region by dragging over its desk preview, as the screenshot picker does.
- 427c184: The screen share picker is laid out as the screenshot picker is: screens and windows in a list beside the desk, which outlines each pick. The screenshot picker offers browser windows that are not on screen, such as a tab behind another.

### Patch Changes

- 00e5da2: Disabled ghost and outline buttons fade further, so they read as disabled next to enabled ones (e.g. the browser's Back and Forward).
- 6730912: A browser window hidden behind a tab can be screenshotted, previewed and shared: the engine lists it as `isCaptured` while a capture runs, and manganese keeps it laid out under the shown tab. The screenshot and share pickers keep their size when a pick shows a preview. A shared screen's cursor reaches consumers that read it as metadata, such as Chrome.
- 2a87739: The screenshot and screen cast pickers take a part of a window that is not on screen, dragged over its preview.
- 8bc5b85: Elements draw an outline only while it can show: on keyboard focus, and always on controls so their focus ring still fades. A transparent outline on every element made Chromium repaint anything that moved, every frame.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- 4759ab2: The share and screenshot pickers call the whole desk "Everything".
- 0f4582e: - The share picker offers the whole desk and picks it at first, as the screenshot picker does.
  - A hidden window's preview keeps the share and screenshot pickers' size.
  - A picked item keeps its fill under the pointer: a selected tab, the current tab rail tab or file picker place, a picked file or picker row.
- b39d80e: A screen cast that may share a monitor may share a region of one too, so a browser's share picker lets you drag an area.
- 113dabe: The boot splash crossfades into manganese's themed background instead of white.
- Updated dependencies [a88ce23]
- Updated dependencies [56e1c22]
- Updated dependencies [e42226f]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [57b5b1f]
- Updated dependencies [93f015d]
- Updated dependencies [3146073]
- Updated dependencies [bbf849b]
- Updated dependencies [3bb9bd5]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [9fd298a]
- Updated dependencies [ee1cc17]
  - @domicile-desktop/sdk@1.1.0
  - @domicile-desktop/system-apps@1.0.1

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/sdk@1.0.0
  - @domicile-desktop/system-apps@1.0.0
