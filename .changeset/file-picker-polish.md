---
"domicile": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-window-management": patch
"@domicile-desktop/system-apps": patch
"@domicile-desktop/e2e-harness": patch
---

File picker polish:

- New folder button, and a Hidden files toggle (Ctrl+H).
- The listing updates when the folder changes.
- A path box (Ctrl+L, or the pencil button). The save name box no longer walks a `/`.
- No key help in the sidebar; full-size sidebar buttons.
- Portal labels drop GTK's `_` access key marks ("_Save" shows as "Save").
- `System.createDir` (`create_dir`) makes a directory. `FileRequest.list` is replaced by `FileRequest.folders` (`systemFolders` in `@domicile-desktop/component-library/folders`).
