# @domicile-desktop/manganese-bar-module-tray

## 1.2.0

### Minor Changes

- 7680c50: Extensions work in every browser profile. An extension the user installs from the Web Store or loads unpacked in one profile is installed in every other, starting on (off in a private profile) and switchable in each, and one they uninstall leaves them all. The tray shows the actions of the focused page's profile's extensions and opens their popups in that profile, so an extension switched on only in another profile, such as 1Password in a work profile, has its icon, popup and sign-in there. The SDK adds `extensions.setProfile`, and each action and popup request carries its `profile`.
- 52e71af: Private windows are a private browser profile's: its extension switches say what runs there. The config's `extensions.settings.<id>.private` is gone, and a config that sets it is refused; so are the SDK's `inPrivate` on installed extensions and in `configureExtension()`, and the Settings app's and tray's "Allow in private windows". The tray now shows the extensions of the last focused page's browser profile ("Extensions in Work"): its icons are those switched on there, and its switches switch them in that profile, locked where the config sets them.
- 69247ca: The tray has a menu of every icon at its end. Pin or unpin any app or extension icon, switch extensions on and off, and change what each can do: its options, which websites it can read, private windows, local files and user scripts, or uninstall it. Settings your config sets show locked. Shells get the same through `domicile.extensions.installed`, `setEnabled`, `configure` and `uninstall`. `Menu` holds check, radio and submenu items, and `ListRow` takes `actions` beside a pressed row.

### Patch Changes

- ce56535: The tray's menu button opens after icons were dragged. A right click anywhere on an app's row in the tray's menu opens its menu, and `ListRow` takes `onSecondaryPress`. A pressed `ListRow` with `actions` cuts a long label short instead of pushing its actions out.
- 3a8d01f: Drop the dot on the tray icons button.
- Updated dependencies [6f4cabd]
- Updated dependencies [02fe478]
- Updated dependencies [b7d85c0]
- Updated dependencies [7680c50]
- Updated dependencies [9478a19]
- Updated dependencies [87ac040]
- Updated dependencies [394ecc7]
- Updated dependencies [8f74f44]
- Updated dependencies [d3978bb]
- Updated dependencies [2794947]
- Updated dependencies [0e71fa1]
- Updated dependencies [d194a0d]
- Updated dependencies [ce56535]
- Updated dependencies [f5fbd04]
- Updated dependencies [4acd3cd]
- Updated dependencies [d0fbc5b]
- Updated dependencies [3977a25]
- Updated dependencies [03dcccf]
- Updated dependencies [996cc29]
- Updated dependencies [5ef4689]
- Updated dependencies [3e37020]
- Updated dependencies [2a1913f]
- Updated dependencies [cd75f9a]
- Updated dependencies [d2a68f5]
- Updated dependencies [c454256]
- Updated dependencies [09a3ad4]
- Updated dependencies [3bdac3b]
- Updated dependencies [f268f2d]
- Updated dependencies [fb07c3f]
- Updated dependencies [24b88fb]
- Updated dependencies [81215c5]
- Updated dependencies [728d513]
- Updated dependencies [d566f68]
- Updated dependencies [86c57d9]
- Updated dependencies [057faa5]
- Updated dependencies [51a769e]
- Updated dependencies [52e71af]
- Updated dependencies [5a70826]
- Updated dependencies [dba9a81]
- Updated dependencies [5c11ddc]
- Updated dependencies [8c477cc]
- Updated dependencies [382819f]
- Updated dependencies [befeb71]
- Updated dependencies [4a4f057]
- Updated dependencies [5b3650f]
- Updated dependencies [ebfad4b]
- Updated dependencies [2bf4b1b]
- Updated dependencies [1cbbfb5]
- Updated dependencies [adb0ef5]
- Updated dependencies [5a896a8]
- Updated dependencies [28238ca]
- Updated dependencies [69247ca]
- Updated dependencies [4799f21]
- Updated dependencies [94e5909]
- Updated dependencies [bc8db8f]
- Updated dependencies [e821d1f]
- Updated dependencies [46d7737]
- Updated dependencies [8ff882e]
- Updated dependencies [14704ae]
- Updated dependencies [0a4d218]
- Updated dependencies [3600d3b]
- Updated dependencies [9c805c4]
- Updated dependencies [9bd54ab]
- Updated dependencies [a2cab16]
- Updated dependencies [d6373e3]
- Updated dependencies [09be8b7]
- Updated dependencies [dabcc0c]
- Updated dependencies [da632d6]
- Updated dependencies [85ad296]
- Updated dependencies [539ce11]
- Updated dependencies [e4f3394]
- Updated dependencies [e7b707c]
- Updated dependencies [8a2777f]
- Updated dependencies [756c1bd]
- Updated dependencies [133ce8a]
- Updated dependencies [b95da52]
- Updated dependencies [9478a19]
- Updated dependencies [a85afe8]
- Updated dependencies [25522ef]
- Updated dependencies [19cc2c5]
- Updated dependencies [a5ade39]
- Updated dependencies [5315b06]
- Updated dependencies [f268f2d]
- Updated dependencies [5fe0d76]
- Updated dependencies [6e41263]
- Updated dependencies [dec9fc2]
- Updated dependencies [6aad1fa]
  - @domicile-desktop/component-library@2.2.0
  - @domicile-desktop/manganese-page-requests@1.3.0
  - @domicile-desktop/sdk@3.0.0
  - @domicile-desktop/react@0.2.0
  - @domicile-desktop/system-apps@1.3.0
  - @domicile-desktop/manganese-bar@1.1.3
  - @domicile-desktop/manganese-host@2.0.3

## 1.1.2

### Patch Changes

- Updated dependencies [f9bbf5d]
- Updated dependencies [c664ef4]
- Updated dependencies [1af639c]
- Updated dependencies [eba7d0d]
- Updated dependencies [62ccd23]
- Updated dependencies [af7415e]
- Updated dependencies [bb1e4cb]
- Updated dependencies [c1988f7]
- Updated dependencies [d69b2f4]
- Updated dependencies [e81703a]
- Updated dependencies [8eaae53]
- Updated dependencies [f592184]
- Updated dependencies [18413ff]
- Updated dependencies [69fe0d8]
- Updated dependencies [3d22f74]
- Updated dependencies [a354497]
- Updated dependencies [75708d7]
- Updated dependencies [9246b97]
- Updated dependencies [50318b4]
- Updated dependencies [cdb3534]
- Updated dependencies [eeb9468]
  - @domicile-desktop/component-library@2.1.0
  - @domicile-desktop/sdk@2.2.0
  - @domicile-desktop/manganese-page-requests@1.2.0
  - @domicile-desktop/system-apps@1.2.0
  - @domicile-desktop/manganese-bar@1.1.2
  - @domicile-desktop/manganese-host@2.0.2
  - @domicile-desktop/react@0.1.2

## 1.1.1

### Patch Changes

- Updated dependencies [fdad979]
  - @domicile-desktop/sdk@2.1.0
  - @domicile-desktop/component-library@2.0.1
  - @domicile-desktop/manganese-host@2.0.1
  - @domicile-desktop/manganese-page-requests@1.1.1
  - @domicile-desktop/react@0.1.1
  - @domicile-desktop/system-apps@1.1.1
  - @domicile-desktop/manganese-bar@1.1.1

## 1.1.0

### Minor Changes

- 62a671f: An extension's `sidePanel.open()` opens its side panel as a tiled window of its own, with no address bar, so Phantom, which opens in its side panel by default from 26.37, opens again. A popup an extension asks for opens under the icon that was clicked, on that monitor, not on the focused one; the tray state gains `clicked`.

### Patch Changes

- a62f35a: Bar item text (battery, keyboard layout, Gmail, mode, tray letters) is 13px, like the clock. New `fontSizes.ui` token (13px), the desktop's one text size.
- ecd3fba: An extension's `action.openPopup()` opens its popup in the tray, so Phantom's tray button opens Phantom. The SDK reports the request as `extensions.on("popup")`.
- 0e8c788: Extension popups size themselves as in Chrome: Blink's auto-resize, between 25x25 and 800x600. Phantom no longer grows wider on every layout, and Solflare gets its full 402x600. The tray shows a popup once its page has loaded, so it no longer opens narrow and then jumps. `contentWidth` and `contentHeight` report only for an `extensionpopup` view. `Popover` takes `withheld`, to lay a panel out before showing it.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- 2fe5852: Everything that took `system(domicile)` takes `desktop(domicile)`, or the namespace it calls.
  
  - SDK: `keyboard.keymaps` and `keyboard.selectKeymap`. `watchMenu`, `readIconTheme`, `watchIconTheme` and `previewFile` take `{ dbus }` or `{ files }`. `MenuSystem`, `IconThemeSystem` and `PreviewSystem` are `MenuDesktop`, `IconThemeDesktop` and `PreviewDesktop`.
  - system-apps: functions take `AppsDesktop` (`./apps-desktop`). `./fake-system`'s `fakeSystem` is `./fake-desktop`'s `fakeDesktop`.
  - component-library: `AppChooser`'s `system` prop is `domicile`; `PortalDialogs`' `systemOf` is `desktopOf`, and its `host` is a whole `DomicileHost`; `systemFolders` is `desktopFolders`, over `domicile.files`; `usePictureUrl` and `useApps` take `domicile.files` and `AppsDesktop`.
- 1971d87: React hooks for system state. Each `system-*` package has a `/react` with hooks and one watch per desktop: `useBattery`, `useBluetooth`, `useNetwork`, `useWifi`, `useAudio` and more. `@domicile-desktop/react` gains the shared watches (`sharedWatch`, `perDesktop`, `useSharedWatch`, `useDeskWatch`, `watchPresence`). manganese-host's `domicile-context`, `per-host`, `shared-watch`, `useSharedWatch` and `watch-presence` move there, and manganese uses `<DomicileProvider>`.
- Updated dependencies [bafd922]
- Updated dependencies [fe90bca]
- Updated dependencies [77fd631]
- Updated dependencies [9e60e1e]
- Updated dependencies [6bbc80b]
- Updated dependencies [a62f35a]
- Updated dependencies [923e65b]
- Updated dependencies [cb4d2f9]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [c7a232d]
- Updated dependencies [66d220b]
- Updated dependencies [a2def76]
- Updated dependencies [d3a65c5]
- Updated dependencies [eca2588]
- Updated dependencies [f15f43a]
- Updated dependencies [7c8d9e2]
- Updated dependencies [fc3ee2f]
- Updated dependencies [9d0934e]
- Updated dependencies [a9a62e8]
- Updated dependencies [fa78a81]
- Updated dependencies [509f948]
- Updated dependencies [a2ee8ea]
- Updated dependencies [22844b3]
- Updated dependencies [c80cd2a]
- Updated dependencies [c03a44b]
- Updated dependencies [9fe15f8]
- Updated dependencies [f71cc09]
- Updated dependencies [aeb6f92]
- Updated dependencies [40f5af3]
- Updated dependencies [ab2d2f0]
- Updated dependencies [17064a7]
- Updated dependencies [a88ce23]
- Updated dependencies [ecd3fba]
- Updated dependencies [0e8c788]
- Updated dependencies [62a671f]
- Updated dependencies [a1569c6]
- Updated dependencies [6fecbbd]
- Updated dependencies [258d9aa]
- Updated dependencies [d9f5353]
- Updated dependencies [fb9e591]
- Updated dependencies [14e6071]
- Updated dependencies [56e1c22]
- Updated dependencies [98d378e]
- Updated dependencies [54472b5]
- Updated dependencies [e42226f]
- Updated dependencies [506b12f]
- Updated dependencies [00e5da2]
- Updated dependencies [75b9403]
- Updated dependencies [3f7e261]
- Updated dependencies [b49fa3a]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [2d2289b]
- Updated dependencies [7a29c8f]
- Updated dependencies [4967b5d]
- Updated dependencies [be59aae]
- Updated dependencies [a999398]
- Updated dependencies [9d4a876]
- Updated dependencies [44d0983]
- Updated dependencies [7ac9e00]
- Updated dependencies [e612f06]
- Updated dependencies [6825067]
- Updated dependencies [cd02e0e]
- Updated dependencies [840418d]
- Updated dependencies [7aa450b]
- Updated dependencies [57b5b1f]
- Updated dependencies [b2c6fd5]
- Updated dependencies [a472a59]
- Updated dependencies [93f015d]
- Updated dependencies [b85d9bb]
- Updated dependencies [01b9340]
- Updated dependencies [fccc784]
- Updated dependencies [2bf4b18]
- Updated dependencies [e1205bb]
- Updated dependencies [40d7378]
- Updated dependencies [670713c]
- Updated dependencies [cd52ce3]
- Updated dependencies [e7cbd52]
- Updated dependencies [8bc5b85]
- Updated dependencies [4ee2c21]
- Updated dependencies [3146073]
- Updated dependencies [bbf849b]
- Updated dependencies [e83ec4a]
- Updated dependencies [7a786a4]
- Updated dependencies [4759ab2]
- Updated dependencies [3bb9bd5]
- Updated dependencies [0f4582e]
- Updated dependencies [d80e2f5]
- Updated dependencies [58d2cfe]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [a5bff8c]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [d138939]
- Updated dependencies [4064278]
- Updated dependencies [f4a973d]
- Updated dependencies [341debf]
- Updated dependencies [ae7874c]
- Updated dependencies [599d60f]
- Updated dependencies [74a9564]
- Updated dependencies [75799a0]
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [c4fe915]
- Updated dependencies [b1041f8]
- Updated dependencies [20a1fc5]
- Updated dependencies [065ff4b]
- Updated dependencies [1e2aeca]
- Updated dependencies [b39d80e]
- Updated dependencies [21b82af]
- Updated dependencies [427c184]
- Updated dependencies [ee63a45]
- Updated dependencies [66bfb0d]
- Updated dependencies [5a6a4fc]
- Updated dependencies [25b9bd3]
- Updated dependencies [113dabe]
- Updated dependencies [0bd0d2a]
- Updated dependencies [d9f5353]
- Updated dependencies [1971d87]
- Updated dependencies [b741b92]
- Updated dependencies [570e7bb]
- Updated dependencies [2edc3c1]
- Updated dependencies [b241f68]
- Updated dependencies [5d2376e]
- Updated dependencies [6c3db42]
- Updated dependencies [9c89f16]
- Updated dependencies [ca86667]
- Updated dependencies [0c58b28]
- Updated dependencies [ee1cc17]
- Updated dependencies [eb6b52a]
- Updated dependencies [63728a9]
  - @domicile-desktop/component-library@2.0.0
  - @domicile-desktop/sdk@2.0.0
  - @domicile-desktop/manganese-bar@1.1.0
  - @domicile-desktop/manganese-host@2.0.0
  - @domicile-desktop/react@0.1.0
  - @domicile-desktop/system-apps@1.1.0
  - @domicile-desktop/manganese-page-requests@1.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/manganese-bar@1.0.0
  - @domicile-desktop/manganese-host@1.0.0
  - @domicile-desktop/manganese-page-requests@1.0.0
  - @domicile-desktop/sdk@1.0.0
  - @domicile-desktop/system-apps@1.0.0
