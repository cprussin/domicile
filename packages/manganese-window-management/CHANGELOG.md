# @domicile-desktop/manganese-window-management

## 1.1.0

### Minor Changes

- e60eb1f: Dropping a window or tab on the middle of another window puts it in that window's tab group, after it, instead of swapping the two. Dropping on any edge of a window in a tab group of one puts the window beside it, rather than into its strip for some edges.
- 44d0983: Switch keyboard layouts at runtime. `input.keyboard.keymaps` lists named keymaps; the first is the one the desktop starts on. The `keymap next` and `keymap <name>` commands switch every keyboard and show a toast, and the new `Keymap` bar item, in the default bar left of the theme toggle and on the lock screen, shows and switches it. The item's list and the toast show xkb's name for each layout. A switch lasts until the desktop restarts. The shell option `keymap.hideDefault` hides the item on the first keymap, and the Settings app's Keyboard page edits the list.
  
  The component library adds `ChoiceRow` (`RadioRow`, `CheckboxRow` and `ChoiceList`), the screenshot picker's rows as a component, and `ChoiceToast` takes a `detail` line.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- f8b1742: New manganese command, for a key or `domicile send-shell`: `night-light` toggles the night light, as the brightness popover's switch does.
- e97b6b2: New manganese commands, for a key or `domicile send-shell`: `virtual-monitor add [<width>x<height>]` adds a monitor with no connector, and `virtual-monitor remove` removes the newest one added.
- 0abccd9: New manganese commands, for a key or `domicile send-shell`: `notifications` toggles the notification drawer, `notifications clear` clears it, and `idle-inhibitor` toggles keeping the screens on.
- 4096040: Pressing a title bar or tab inside a selected group selects just that window. A title bar's float and fullscreen buttons act on their own window, never the selected group, and a tab of a floating group tiles alone. `Stage` takes `onBarPress`, and `WindowAction.WindowBarPressed` is new.
- d862eaa: Browser windows show a brief popover over the page when the zoom changes or a download finishes, including app windows and fullscreen pages.

### Patch Changes

- 1062efc: A workspace switch slides normally onto a browser window whose page has a dialog, file picker or find bar open.
- e455955: `domicile open <file|folder|url>` opens anything: a web link in a browser window, anything else with its type's default from `mimeapps.list`, supertypes counted (a `text/plain` default opens Markdown and source code). `domicile open --app <url|module>` opens a site or app module as an app. Domicile's `xdg-open` and the launcher's Enter run it, so apps, terminals and the launcher agree. `open-url`, `open-app` and `run-app` are gone: use `open` and `open --app`.
- 7c948b4: A tab dragged along its strip slides into each new slot instead of jumping there.
- 56e1c22: File picker polish:
  
  - New folder button, and a Hidden files toggle (Ctrl+H).
  - The listing updates when the folder changes.
  - A path box (Ctrl+L, or the pencil button). The save name box no longer walks a `/`.
  - No key help in the sidebar; full-size sidebar buttons.
  - Portal labels drop GTK's `_` access key marks ("_Save" shows as "Save").
  - `System.createDir` (`create_dir`) makes a directory. `FileRequest.list` is replaced by `FileRequest.folders` (`systemFolders` in `@domicile-desktop/component-library/folders`).
- 920763e: A float that trades places with another moves as one: its hidden tabs and nested groups' tabs, strips and wells move with its open tab.
- 83f9f2d: A floating window dragged over the edge of its monitor stays over the next monitor's floating windows: floats on the monitor with the keyboard stack over every other monitor's.
- a390b06: A selected tab group keeps its selection tint while fullscreen.
- c9c75a8: A tab group's fullscreen button leaves the selection on the open tab instead of moving it to the group.
- 8bc5b85: Dragging or resizing a window repaints far less: each part of a held window gets its own layer, and the scratchpad's `--lift` is set only while it slides, not on every pointer move.
- 6730912: A browser window hidden behind a tab can be screenshotted, previewed and shared: the engine lists it as `isCaptured` while a capture runs, and manganese keeps it laid out under the shown tab. The screenshot and share pickers keep their size when a pick shows a preview. A shared screen's cursor reaches consumers that read it as metadata, such as Chrome.
- 452a746: The focused window's ring shows in light mode: a solid accent ring with a pale outer band replaces the faint glow.
- 1ad2756: Volume, microphone and brightness keys show the new level in a notice on the focused screen.
- 93f015d: A page can ask for window management, local fonts, idle detection and automatic downloads. The shell asks the user, and Settings and the site panel show each.
- e781b22: Moving a window into or out of a group nested in a tab moves only that window: the outer tab strip no longer flies out of or into the group's well, and the group's tab eases to its new slot instead of jumping.
- 6b2a242: Nested tab groups animate and light properly: a tab switch or new window in a nested group no longer zooms its strip in from the outer group's, switching away from a nested group no longer shrinks its windows away, and a group selected inside a tab is lit around its own windows.
- 9a0cf19: A divider marks off a tab group's new-tab button from a hidden last tab, as between two hidden tabs.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- 48ab992: A browser window's file picker keeps the keyboard when the waiting page takes focus, so typing a name works after saving from the PDF viewer.
- 3bb9bd5: A download's file picker starts in the download folder (`XDG_DOWNLOAD_DIR`). The file chooser event has `currentFolder`.
- 2fe5852: Everything that took `system(domicile)` takes `desktop(domicile)`, or the namespace it calls.
  
  - SDK: `keyboard.keymaps` and `keyboard.selectKeymap`. `watchMenu`, `readIconTheme`, `watchIconTheme` and `previewFile` take `{ dbus }` or `{ files }`. `MenuSystem`, `IconThemeSystem` and `PreviewSystem` are `MenuDesktop`, `IconThemeDesktop` and `PreviewDesktop`.
  - system-apps: functions take `AppsDesktop` (`./apps-desktop`). `./fake-system`'s `fakeSystem` is `./fake-desktop`'s `fakeDesktop`.
  - component-library: `AppChooser`'s `system` prop is `domicile`; `PortalDialogs`' `systemOf` is `desktopOf`, and its `host` is a whole `DomicileHost`; `systemFolders` is `desktopFolders`, over `domicile.files`; `usePictureUrl` and `useApps` take `domicile.files` and `AppsDesktop`.
- 50f2549: `search-clipboard` (Meta+Shift+Space) opens a private window when the active window is private.
- 45c846a: The Meta+A selection tint covers a tab group's open tab too.
- 0bbe0f9: An accent tint covers the container Meta+A selects, tabs and windows included. It replaces the accent line along a selected group's tabs.
- 6a34b99: Pressing or dragging the empty end of a tiled tab strip no longer selects the whole group. It focuses the open tab and keeps any selection already around it; the drag still moves the whole group.
- da8b0a7: Dropping a dragged tab group no longer selects the whole group. The group's open tab is focused, and the group stays selected only if it was selected before the drag.
- f45bf2b: Dragging a window over any part of a tab strip adds it as a tab beside the nearest tab, shown as a line between the tabs. The drop overlay is drawn over open tabs.
- 46f285a: Keep a tab group's focus glow steady while its tabs are reordered, instead of flashing.
- eb6b52a: Dragging a browser window's edge no longer holds the whole desktop to the page's pace. While a `<webview>` has the `resizing` attribute, as an `<app>` already could, the page's latest frame stretches to each new box at once instead of the desktop waiting for the page to draw at it. Manganese sets it on every browser window during a resize.
- Updated dependencies [bafd922]
- Updated dependencies [9e60e1e]
- Updated dependencies [6bbc80b]
- Updated dependencies [923e65b]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [40f5af3]
- Updated dependencies [ab2d2f0]
- Updated dependencies [a88ce23]
- Updated dependencies [14e6071]
- Updated dependencies [56e1c22]
- Updated dependencies [e42226f]
- Updated dependencies [506b12f]
- Updated dependencies [00e5da2]
- Updated dependencies [75b9403]
- Updated dependencies [3f7e261]
- Updated dependencies [b49fa3a]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [44d0983]
- Updated dependencies [e612f06]
- Updated dependencies [cd02e0e]
- Updated dependencies [57b5b1f]
- Updated dependencies [b2c6fd5]
- Updated dependencies [93f015d]
- Updated dependencies [fccc784]
- Updated dependencies [e1205bb]
- Updated dependencies [670713c]
- Updated dependencies [cd52ce3]
- Updated dependencies [8bc5b85]
- Updated dependencies [3146073]
- Updated dependencies [bbf849b]
- Updated dependencies [4759ab2]
- Updated dependencies [3bb9bd5]
- Updated dependencies [0f4582e]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [75799a0]
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [c4fe915]
- Updated dependencies [b1041f8]
- Updated dependencies [20a1fc5]
- Updated dependencies [b39d80e]
- Updated dependencies [21b82af]
- Updated dependencies [427c184]
- Updated dependencies [ee63a45]
- Updated dependencies [113dabe]
- Updated dependencies [b241f68]
- Updated dependencies [ca86667]
- Updated dependencies [ee1cc17]
- Updated dependencies [eb6b52a]
  - @domicile-desktop/component-library@1.1.0
  - @domicile-desktop/manganese-bar@1.1.0
  - @domicile-desktop/manganese-host@1.1.0
  - @domicile-desktop/sdk@1.1.0
  - @domicile-desktop/system-apps@1.1.0
  - @domicile-desktop/manganese-page-requests@1.1.0
  - @domicile-desktop/manganese-address@1.0.1

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- c705ff5: `loadEmittedStylesheet` removes its stylesheet once the enclosing file or `describe` has run. Test files share one document, so stylesheets left behind slowed every later file's style lookups until `BrowserWindow`'s context-menu tests timed out in CI. `BrowserWindow`'s tests load it only where they read a style.
- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/manganese-address@1.0.0
  - @domicile-desktop/manganese-bar@1.0.0
  - @domicile-desktop/manganese-host@1.0.0
  - @domicile-desktop/manganese-page-requests@1.0.0
  - @domicile-desktop/sdk@1.0.0
  - @domicile-desktop/system-apps@1.0.0
