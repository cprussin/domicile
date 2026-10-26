# @domicile-desktop/manganese-bar-module-keymap

## 0.1.0

### Minor Changes

- 44d0983: Switch keyboard layouts at runtime. `input.keyboard.keymaps` lists named keymaps; the first is the one the desktop starts on. The `keymap next` and `keymap <name>` commands switch every keyboard and show a toast, and the new `Keymap` bar item, in the default bar left of the theme toggle and on the lock screen, shows and switches it. The item's list and the toast show xkb's name for each layout. A switch lasts until the desktop restarts. The shell option `keymap.hideDefault` hides the item on the first keymap, and the Settings app's Keyboard page edits the list.
  
  The component library adds `ChoiceRow` (`RadioRow`, `CheckboxRow` and `ChoiceList`), the screenshot picker's rows as a component, and `ChoiceToast` takes a `detail` line.

### Patch Changes

- 923e65b: Top bar tooltips are design-system tooltips: a frosted pill under the item that stays on its screen. `Tooltip` takes a `tone`, and `Popover` takes a `tooltip` for its trigger.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- 2fe5852: Everything that took `system(domicile)` takes `desktop(domicile)`, or the namespace it calls.
  
  - SDK: `keyboard.keymaps` and `keyboard.selectKeymap`. `watchMenu`, `readIconTheme`, `watchIconTheme` and `previewFile` take `{ dbus }` or `{ files }`. `MenuSystem`, `IconThemeSystem` and `PreviewSystem` are `MenuDesktop`, `IconThemeDesktop` and `PreviewDesktop`.
  - system-apps: functions take `AppsDesktop` (`./apps-desktop`). `./fake-system`'s `fakeSystem` is `./fake-desktop`'s `fakeDesktop`.
  - component-library: `AppChooser`'s `system` prop is `domicile`; `PortalDialogs`' `systemOf` is `desktopOf`, and its `host` is a whole `DomicileHost`; `systemFolders` is `desktopFolders`, over `domicile.files`; `usePictureUrl` and `useApps` take `domicile.files` and `AppsDesktop`.
- 1971d87: React hooks for system state. Each `system-*` package has a `/react` with hooks and one watch per desktop: `useBattery`, `useBluetooth`, `useNetwork`, `useWifi`, `useAudio` and more. `@domicile-desktop/react` gains the shared watches (`sharedWatch`, `perDesktop`, `useSharedWatch`, `useDeskWatch`, `watchPresence`). manganese-host's `domicile-context`, `per-host`, `shared-watch`, `useSharedWatch` and `watch-presence` move there, and manganese uses `<DomicileProvider>`.
- Updated dependencies [bafd922]
- Updated dependencies [9e60e1e]
- Updated dependencies [6bbc80b]
- Updated dependencies [923e65b]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [c03a44b]
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
- Updated dependencies [cd02e0e]
- Updated dependencies [57b5b1f]
- Updated dependencies [b2c6fd5]
- Updated dependencies [93f015d]
- Updated dependencies [b85d9bb]
- Updated dependencies [fccc784]
- Updated dependencies [e1205bb]
- Updated dependencies [670713c]
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
- Updated dependencies [1971d87]
- Updated dependencies [2edc3c1]
- Updated dependencies [b241f68]
- Updated dependencies [ca86667]
- Updated dependencies [ee1cc17]
- Updated dependencies [eb6b52a]
  - @domicile-desktop/component-library@1.1.0
  - @domicile-desktop/manganese-bar@1.1.0
  - @domicile-desktop/manganese-host@2.0.0
  - @domicile-desktop/sdk@1.1.0
  - @domicile-desktop/react@0.1.0
