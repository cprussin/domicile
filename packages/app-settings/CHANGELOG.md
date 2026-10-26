# @domicile-desktop/app-settings

## 0.1.0

### Minor Changes

- 44d0983: Switch keyboard layouts at runtime. `input.keyboard.keymaps` lists named keymaps; the first is the one the desktop starts on. The `keymap next` and `keymap <name>` commands switch every keyboard and show a toast, and the new `Keymap` bar item, in the default bar left of the theme toggle and on the lock screen, shows and switches it. The item's list and the toast show xkb's name for each layout. A switch lasts until the desktop restarts. The shell option `keymap.hideDefault` hides the item on the first keymap, and the Settings app's Keyboard page edits the list.
  
  The component library adds `ChoiceRow` (`RadioRow`, `CheckboxRow` and `ChoiceList`), the screenshot picker's rows as a component, and `ChoiceToast` takes a `detail` line.
- 93f015d: A page can ask for window management, local fonts, idle detection and automatic downloads. The shell asks the user, and Settings and the site panel show each.
- 33444d9: Settings has a Site data page: each site that stores cookies or other data, its size, and a button that removes it.

### Patch Changes

- bafd922: Settings and History show their icon in title bars and the screenshot and screen recording pickers. The pickers also show each browser window's site icon.
- e455955: `domicile open <file|folder|url>` opens anything: a web link in a browser window, anything else with its type's default from `mimeapps.list`, supertypes counted (a `text/plain` default opens Markdown and source code). `domicile open --app <url|module>` opens a site or app module as an app. Domicile's `xdg-open` and the launcher's Enter run it, so apps, terminals and the launcher agree. `open-url`, `open-app` and `run-app` are gone: use `open` and `open --app`.
- c03a44b: New `@domicile-desktop/react`: `mount(App)` makes a shell's `Shell` or an app's `main`; `<DomicileProvider>`, `useDomicile`, `useAppDomicile`, `useWatch`, hooks for windows, displays, appearance, session and portals, and `<FakeDomicile>` for tests. The simple shell and the History and Settings apps mount with it.
- ab2d2f0: The engine hands `Shell` the typed `Domicile` and an app's `main` the `AppDomicile`, built by the SDK's layer, which the engine bundles. Shells and apps no longer call `desktop()`/`appDesktop()`. The SDK drops `system()`, the portal watch helpers and `./appearance` from its public API; use the `Domicile` namespaces.
- e42226f: `theme.force_dark` names sites, such as `mail.google.com`, that the browser draws dark with Chromium's automatic dark mode while the theme is dark, for sites with no dark theme of their own.
- 75b9403: Ghost and other buttons in Settings, History and the site lose the outline they drew when not focused. The preset now sets the page's color scheme, light or dark, so packages no longer replace its `html` rules. A switch in Settings says "Off" when it is off.
- fccc784: Automatic brightness and a night light, as on macOS. The backlight follows the room's light from iio-sensor-proxy and learns from the levels the user sets. The night light warms every monitor from sunset to sunrise in the time zone's city, or on custom hours, with a switch in the brightness popover. Both are on by default and set in the Settings app's Shell page or under `shell_options`. Shells set the color temperature with `domicile.displays.setColorTemperature(kelvin)`.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- 2fe5852: Everything that took `system(domicile)` takes `desktop(domicile)`, or the namespace it calls.
  
  - SDK: `keyboard.keymaps` and `keyboard.selectKeymap`. `watchMenu`, `readIconTheme`, `watchIconTheme` and `previewFile` take `{ dbus }` or `{ files }`. `MenuSystem`, `IconThemeSystem` and `PreviewSystem` are `MenuDesktop`, `IconThemeDesktop` and `PreviewDesktop`.
  - system-apps: functions take `AppsDesktop` (`./apps-desktop`). `./fake-system`'s `fakeSystem` is `./fake-desktop`'s `fakeDesktop`.
  - component-library: `AppChooser`'s `system` prop is `domicile`; `PortalDialogs`' `systemOf` is `desktopOf`, and its `host` is a whole `DomicileHost`; `systemFolders` is `desktopFolders`, over `domicile.files`; `usePictureUrl` and `useApps` take `domicile.files` and `AppsDesktop`.
- Updated dependencies [bafd922]
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
- Updated dependencies [b241f68]
- Updated dependencies [ca86667]
- Updated dependencies [ee1cc17]
- Updated dependencies [eb6b52a]
  - @domicile-desktop/component-library@1.1.0
  - @domicile-desktop/sdk@1.1.0
  - @domicile-desktop/react@0.1.0

## 0.0.1

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/sdk@1.0.0
