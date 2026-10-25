# @domicile-desktop/manganese

## 1.1.0

### Minor Changes

- 3980a9a: A `Cast` bar item lists the TVs nearby: extend the desktop onto one, or cast what the share picker picks to it. `@domicile-desktop/sdk/cast` runs the casts, and `<PortalDialogs />` answers a cast's own ScreenCast request. No backend finds TVs yet, so the item stays hidden.
- 623860a: While a TV is cast to, the desk holds off idle blanking and holds notification banners, which the TV could show. `inhibitIdle` takes the reason the portal is told.
- b49fa3a: Add a Google Messages bar item: Messages for web in a panel, with a count of its new messages. Popovers can stay mounted while closed and open from triggers on other bars, and a bar item's panel can keep the keyboard.
- 44d0983: Switch keyboard layouts at runtime. `input.keyboard.keymaps` lists named keymaps; the first is the one the desktop starts on. The `keymap next` and `keymap <name>` commands switch every keyboard and show a toast, and the new `Keymap` bar item, in the default bar left of the theme toggle and on the lock screen, shows and switches it. The item's list and the toast show xkb's name for each layout. A switch lasts until the desktop restarts. The shell option `keymap.hideDefault` hides the item on the first keymap, and the Settings app's Keyboard page edits the list.
  
  The component library adds `ChoiceRow` (`RadioRow`, `CheckboxRow` and `ChoiceList`), the screenshot picker's rows as a component, and `ChoiceToast` takes a `detail` line.
- 1ad2756: Volume, microphone and brightness keys show the new level in a notice on the focused screen.
- 0abccd9: New manganese commands, for a key or `domicile send-shell`: `notifications` toggles the notification drawer, `notifications clear` clears it, and `idle-inhibitor` toggles keeping the screens on.

### Patch Changes

- 1062efc: A workspace switch slides normally onto a browser window whose page has a dialog, file picker or find bar open.
- ab2d2f0: The engine hands `Shell` the typed `Domicile` and an app's `main` the `AppDomicile`, built by the SDK's layer, which the engine bundles. Shells and apps no longer call `desktop()`/`appDesktop()`. The SDK drops `system()`, the portal watch helpers and `./appearance` from its public API; use the `Domicile` namespaces.
- 6730912: A browser window hidden behind a tab can be screenshotted, previewed and shared: the engine lists it as `isCaptured` while a capture runs, and manganese keeps it laid out under the shown tab. The screenshot and share pickers keep their size when a pick shows a preview. A shared screen's cursor reaches consumers that read it as metadata, such as Chrome.
- cd02e0e: The volume, microphone and brightness toast is larger, with a big icon, the level as a number and a thick meter. Pressing a key again while it is up updates it in place instead of showing it again. The component library adds `LevelToast`.
- e781b22: Moving a window into or out of a group nested in a tab moves only that window: the outer tab strip no longer flies out of or into the group's well, and the group's tab eases to its new slot instead of jumping.
- 6b2a242: Nested tab groups animate and light properly: a tab switch or new window in a nested group no longer zooms its strip in from the outer group's, switching away from a nested group no longer shrinks its windows away, and a group selected inside a tab is lit around its own windows.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- 2fe5852: Everything that took `system(domicile)` takes `desktop(domicile)`, or the namespace it calls.
  
  - SDK: `keyboard.keymaps` and `keyboard.selectKeymap`. `watchMenu`, `readIconTheme`, `watchIconTheme` and `previewFile` take `{ dbus }` or `{ files }`. `MenuSystem`, `IconThemeSystem` and `PreviewSystem` are `MenuDesktop`, `IconThemeDesktop` and `PreviewDesktop`.
  - system-apps: functions take `AppsDesktop` (`./apps-desktop`). `./fake-system`'s `fakeSystem` is `./fake-desktop`'s `fakeDesktop`.
  - component-library: `AppChooser`'s `system` prop is `domicile`; `PortalDialogs`' `systemOf` is `desktopOf`, and its `host` is a whole `DomicileHost`; `systemFolders` is `desktopFolders`, over `domicile.files`; `usePictureUrl` and `useApps` take `domicile.files` and `AppsDesktop`.
- c4fe915: The screenshot picker lists what to save beside one preview of the desk, which outlines the pick with its size. It fits on the screen, arrow keys move through the list, and a Copy button copies the pick.
- b1041f8: The last package-specific scripts leave `scripts/`: `dev-shell` becomes a package the shells' `start:dev` runs, docs media capture moves into the site, `update-engine-release.sh` and the IDL check into the engine, and `smoke-compositor.sh` into the e2e harness.
- 45c846a: The Meta+A selection tint covers a tab group's open tab too.
- 0bbe0f9: An accent tint covers the container Meta+A selects, tabs and windows included. It replaces the accent line along a selected group's tabs.
- 113dabe: The boot splash crossfades into manganese's themed background instead of white.
- f45bf2b: Dragging a window over any part of a tab strip adds it as a tab beside the nearest tab, shown as a line between the tabs. The drop overlay is drawn over open tabs.
- 4096040: Pressing a title bar or tab inside a selected group selects just that window. A title bar's float and fullscreen buttons act on their own window, never the selected group, and a tab of a floating group tiles alone. `Stage` takes `onBarPress`, and `WindowAction.WindowBarPressed` is new.
- Updated dependencies [1caba05]
- Updated dependencies [9e60e1e]
- Updated dependencies [6bbc80b]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [623860a]
- Updated dependencies [1062efc]
- Updated dependencies [e455955]
- Updated dependencies [7c948b4]
- Updated dependencies [e60eb1f]
- Updated dependencies [40f5af3]
- Updated dependencies [ab2d2f0]
- Updated dependencies [a88ce23]
- Updated dependencies [56e1c22]
- Updated dependencies [920763e]
- Updated dependencies [e42226f]
- Updated dependencies [506b12f]
- Updated dependencies [a390b06]
- Updated dependencies [00e5da2]
- Updated dependencies [690c592]
- Updated dependencies [3f7e261]
- Updated dependencies [b49fa3a]
- Updated dependencies [9f441cd]
- Updated dependencies [2b1b80f]
- Updated dependencies [4856cc9]
- Updated dependencies [35b8470]
- Updated dependencies [c9c75a8]
- Updated dependencies [8bc5b85]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [44d0983]
- Updated dependencies [cd02e0e]
- Updated dependencies [452a746]
- Updated dependencies [57b5b1f]
- Updated dependencies [1ad2756]
- Updated dependencies [b2c6fd5]
- Updated dependencies [93f015d]
- Updated dependencies [e781b22]
- Updated dependencies [6b2a242]
- Updated dependencies [558794b]
- Updated dependencies [59b63cd]
- Updated dependencies [9a0cf19]
- Updated dependencies [e1205bb]
- Updated dependencies [670713c]
- Updated dependencies [cd52ce3]
- Updated dependencies [8bc5b85]
- Updated dependencies [3146073]
- Updated dependencies [bbf849b]
- Updated dependencies [4759ab2]
- Updated dependencies [48ab992]
- Updated dependencies [3bb9bd5]
- Updated dependencies [0f4582e]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [1f1775a]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [50f2549]
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [c4fe915]
- Updated dependencies [b1041f8]
- Updated dependencies [20a1fc5]
- Updated dependencies [45c846a]
- Updated dependencies [0bbe0f9]
- Updated dependencies [b39d80e]
- Updated dependencies [21b82af]
- Updated dependencies [427c184]
- Updated dependencies [ee63a45]
- Updated dependencies [0abccd9]
- Updated dependencies [113dabe]
- Updated dependencies [6a34b99]
- Updated dependencies [da8b0a7]
- Updated dependencies [f45bf2b]
- Updated dependencies [4096040]
- Updated dependencies [46f285a]
- Updated dependencies [b241f68]
- Updated dependencies [ca86667]
- Updated dependencies [ee1cc17]
- Updated dependencies [d862eaa]
- Updated dependencies [1d6f437]
  - @domicile-desktop/manganese-bar-module-bluetooth@1.1.0
  - @domicile-desktop/manganese-bar-module-idle-inhibitor@1.1.0
  - @domicile-desktop/manganese-bar-module-network@1.1.0
  - @domicile-desktop/manganese-bar-module-volume@1.1.0
  - @domicile-desktop/manganese-bar@1.1.0
  - @domicile-desktop/manganese-bar-module-battery@1.1.0
  - @domicile-desktop/manganese-bar-module-gmail@1.1.0
  - @domicile-desktop/manganese-host@1.1.0
  - @domicile-desktop/manganese-bar-module-brightness@1.1.0
  - @domicile-desktop/component-library@1.1.0
  - @domicile-desktop/sdk@1.1.0
  - @domicile-desktop/manganese-bar-module-cast@0.1.0
  - @domicile-desktop/manganese-window-management@1.1.0
  - @domicile-desktop/manganese-launcher@1.0.1
  - @domicile-desktop/manganese-bar-module-sharing@1.1.0
  - @domicile-desktop/manganese-bar-module-google-messages@1.0.0
  - @domicile-desktop/manganese-bar-module-notifications@1.0.1
  - @domicile-desktop/manganese-bar-module-keymap@0.1.0
  - @domicile-desktop/manganese-bar-module-clock@1.0.1
  - @domicile-desktop/manganese-bar-module-launcher-button@1.0.1
  - @domicile-desktop/manganese-bar-module-theme-switch@1.0.1
  - @domicile-desktop/manganese-bar-module-tray@1.0.1
  - @domicile-desktop/manganese-bar-module-workspace-switcher@1.0.1
  - @domicile-desktop/manganese-clipboard@1.0.1
  - @domicile-desktop/manganese-lock@1.0.1
  - @domicile-desktop/manganese-notifications@1.0.1
  - @domicile-desktop/manganese-wallpaper@1.0.1

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- 0bf1018: The boot splash crossfades straight into the shell instead of through a white page.
- Updated dependencies [c705ff5]
- Updated dependencies [2056529]
- Updated dependencies [0ff84ad]
  - @domicile-desktop/manganese-window-management@1.0.0
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/manganese-bar@1.0.0
  - @domicile-desktop/manganese-bar-module-battery@1.0.0
  - @domicile-desktop/manganese-bar-module-bluetooth@1.0.0
  - @domicile-desktop/manganese-bar-module-brightness@1.0.0
  - @domicile-desktop/manganese-bar-module-clock@1.0.0
  - @domicile-desktop/manganese-bar-module-gmail@1.0.0
  - @domicile-desktop/manganese-bar-module-idle-inhibitor@1.0.0
  - @domicile-desktop/manganese-bar-module-launcher-button@1.0.0
  - @domicile-desktop/manganese-bar-module-network@1.0.0
  - @domicile-desktop/manganese-bar-module-notifications@1.0.0
  - @domicile-desktop/manganese-bar-module-sharing@1.0.0
  - @domicile-desktop/manganese-bar-module-theme-switch@1.0.0
  - @domicile-desktop/manganese-bar-module-tray@1.0.0
  - @domicile-desktop/manganese-bar-module-volume@1.0.0
  - @domicile-desktop/manganese-bar-module-workspace-switcher@1.0.0
  - @domicile-desktop/manganese-clipboard@1.0.0
  - @domicile-desktop/manganese-host@1.0.0
  - @domicile-desktop/manganese-launcher@1.0.0
  - @domicile-desktop/manganese-lock@1.0.0
  - @domicile-desktop/manganese-notifications@1.0.0
  - @domicile-desktop/manganese-wallpaper@1.0.0
  - @domicile-desktop/sdk@1.0.0
