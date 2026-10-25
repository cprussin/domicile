# @domicile-desktop/component-library

## 1.1.0

### Minor Changes

- 3980a9a: A `Cast` bar item lists the TVs nearby: extend the desktop onto one, or cast what the share picker picks to it. `@domicile-desktop/sdk/cast` runs the casts, and `<PortalDialogs />` answers a cast's own ScreenCast request. No backend finds TVs yet, so the item stays hidden.
- 56e1c22: File picker polish:
  
  - New folder button, and a Hidden files toggle (Ctrl+H).
  - The listing updates when the folder changes.
  - A path box (Ctrl+L, or the pencil button). The save name box no longer walks a `/`.
  - No key help in the sidebar; full-size sidebar buttons.
  - Portal labels drop GTK's `_` access key marks ("_Save" shows as "Save").
  - `System.createDir` (`create_dir`) makes a directory. `FileRequest.list` is replaced by `FileRequest.folders` (`systemFolders` in `@domicile-desktop/component-library/folders`).
- 3f7e261: Gmail's unread count is a badge on the item's end corner, like Messages and the notification bell; the item shows the inbox total. The badge is the new `CountBadge` component, which Messages and the bell now share. Messages caps its badge at "9+" and pops it in, as the bell does.
- b49fa3a: Add a Google Messages bar item: Messages for web in a panel, with a count of its new messages. Popovers can stay mounted while closed and open from triggers on other bars, and a bar item's panel can keep the keyboard.
- 44d0983: Switch keyboard layouts at runtime. `input.keyboard.keymaps` lists named keymaps; the first is the one the desktop starts on. The `keymap next` and `keymap <name>` commands switch every keyboard and show a toast, and the new `Keymap` bar item, in the default bar left of the theme toggle and on the lock screen, shows and switches it. The item's list and the toast show xkb's name for each layout. A switch lasts until the desktop restarts. The shell option `keymap.hideDefault` hides the item on the first keymap, and the Settings app's Keyboard page edits the list.
  
  The component library adds `ChoiceRow` (`RadioRow`, `CheckboxRow` and `ChoiceList`), the screenshot picker's rows as a component, and `ChoiceToast` takes a `detail` line.
- cd02e0e: The volume, microphone and brightness toast is larger, with a big icon, the level as a number and a thick meter. Pressing a key again while it is up updates it in place instead of showing it again. The component library adds `LevelToast`.
- e1205bb: Add `Notice`, a pill that briefly shows a change such as a zoom level or volume, with an optional level meter.
- 670713c: The app chooser asks in plain words. With one application it asks "Open Claude?" beside Claude's icon ("Chromium wants to open this link in Claude."); with several, "Choose an app to open this link"; with none, "No app can open this link" and only Close. The link shows on one muted line at the bottom. `AppChooser` takes `asker`, `opened` and `address` in place of `title` and `description`.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- 2fe5852: Everything that took `system(domicile)` takes `desktop(domicile)`, or the namespace it calls.
  
  - SDK: `keyboard.keymaps` and `keyboard.selectKeymap`. `watchMenu`, `readIconTheme`, `watchIconTheme` and `previewFile` take `{ dbus }` or `{ files }`. `MenuSystem`, `IconThemeSystem` and `PreviewSystem` are `MenuDesktop`, `IconThemeDesktop` and `PreviewDesktop`.
  - system-apps: functions take `AppsDesktop` (`./apps-desktop`). `./fake-system`'s `fakeSystem` is `./fake-desktop`'s `fakeDesktop`.
  - component-library: `AppChooser`'s `system` prop is `domicile`; `PortalDialogs`' `systemOf` is `desktopOf`, and its `host` is a whole `DomicileHost`; `systemFolders` is `desktopFolders`, over `domicile.files`; `usePictureUrl` and `useApps` take `domicile.files` and `AppsDesktop`.
- 52a1d65: The screenshot and screen share pickers draw a window that is not on screen, such as a tab behind another, in place of the desk when it is picked. `System.previewWindow` draws one, through the compositor's new `preview_window` system call.
- 3e5b976: The print dialog labels every option and saves to PDF: pick "Save to PDF" as the destination, then where to save it.
- 9fd298a: The screen share picker offers browser windows, streaming the page alone, and previews each source on the desk. The screenshot picker shows the same preview tiles.
- c4fe915: The screenshot picker lists what to save beside one preview of the desk, which outlines the pick with its size. It fits on the screen, arrow keys move through the list, and a Copy button copies the pick.
- 21b82af: The share picker picks a region by dragging over its desk preview, as the screenshot picker does.
- 427c184: The screen share picker is laid out as the screenshot picker is: screens and windows in a list beside the desk, which outlines each pick. The screenshot picker offers browser windows that are not on screen, such as a tab behind another.

### Patch Changes

- 44eb13c: A screenshot, color pick or screen cast opens over a portal dialog already up, such as the app chooser, so it can capture that dialog.
- ab2d2f0: The engine hands `Shell` the typed `Domicile` and an app's `main` the `AppDomicile`, built by the SDK's layer, which the engine bundles. Shells and apps no longer call `desktop()`/`appDesktop()`. The SDK drops `system()`, the portal watch helpers and `./appearance` from its public API; use the `Domicile` namespaces.
- 506b12f: Apps known only by an id that no desktop entry uses, such as `com.chromium.Chromium`, are named by a matching entry or a readable form of the id ("Chromium") in portal dialogs, the sharing indicators, global shortcut conflicts and portal notifications.
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
- ee63a45: The top bar's sharing indicator says what is shared. It is a red "Sharing screen" pill, and its panel lists each source by name with what of it is shared: a window with its application, a screen by make and model, all screens, or part of a screen with its size. A region covering one whole screen is listed as that screen, and one covering every screen as all of them, instead of "Region". `Captured` carries a window's app id, a monitor's description, the monitor a region is on, and a new `Desk` kind.
- 113dabe: The boot splash crossfades into manganese's themed background instead of white.
- b241f68: A desktop that boots in a different theme from the one its shell remembered no longer stays stuck half faded in and ignoring the pointer. The compositor answers a theme capture with nothing to turn, and a wipe's hold can no longer freeze another view transition.
- Updated dependencies [3980a9a]
- Updated dependencies [40f5af3]
- Updated dependencies [ab2d2f0]
- Updated dependencies [a88ce23]
- Updated dependencies [56e1c22]
- Updated dependencies [e42226f]
- Updated dependencies [506b12f]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [44d0983]
- Updated dependencies [e612f06]
- Updated dependencies [57b5b1f]
- Updated dependencies [b2c6fd5]
- Updated dependencies [93f015d]
- Updated dependencies [3146073]
- Updated dependencies [bbf849b]
- Updated dependencies [3bb9bd5]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [9fd298a]
- Updated dependencies [b1041f8]
- Updated dependencies [20a1fc5]
- Updated dependencies [ee63a45]
- Updated dependencies [ca86667]
- Updated dependencies [ee1cc17]
  - @domicile-desktop/sdk@1.1.0
  - @domicile-desktop/system-apps@1.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/sdk@1.0.0
  - @domicile-desktop/system-apps@1.0.0
