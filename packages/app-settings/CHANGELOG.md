# @domicile-desktop/app-settings

## 0.2.0

### Minor Changes

- 6f3ec06: Settings has a Profiles page: a card per browser profile with its color, whether it is private and its extension switches, and one list of the sites that open outside the default profile. Profiles, colors, Private and the default change in the config; extension switches and sites added here are saved by the desktop, under the config's. Adding a site that is already listed points at its row. The engine's command socket answers `browser_profiles` and `pin_browser_site`, and `set_extension_enabled` takes a `profile`.
- 60e7c7e: Settings shows "Not supported" in place of the HDR switch for a plugged-in monitor that can't show HDR. It learns which monitors those are from the new `which_monitors` question, which the compositor answers with each lit monitor's names and HDR state.
- 52e71af: Private windows are a private browser profile's: its extension switches say what runs there. The config's `extensions.settings.<id>.private` is gone, and a config that sets it is refused; so are the SDK's `inPrivate` on installed extensions and in `configureExtension()`, and the Settings app's and tray's "Allow in private windows". The tray now shows the extensions of the last focused page's browser profile ("Extensions in Work"): its icons are those switched on there, and its switches switch them in that profile, locked where the config sets them.
- 1036a91: Settings has a Troubleshooting page: **Detailed logging** turns on debug logging until the desktop restarts, and **Save logs** saves `domicile export-logs` to Downloads, with web addresses and window titles hidden unless you turn that off.
- ffe3faa: The desk's certificate request through the relay names only the desk's address. It had carried rcgen's default subject, "rcgen self signed cert", which Let's Encrypt refuses, so Connect from the web never got ready. A failed request now tries again after 2 minutes, doubling up to an hour, and **Try again** in Settings › Agents tries at once.
- 46d7737: Settings › Agents › Connect from the web turns on `agents.web`, which has the desktop run `domicile mcp --relay` so agents on the web, such as claude.ai, can reach it. Settings shows the desktop's address to copy into the agent, whether it is ready, and each agent signed in, with Sign out.
- 8ff882e: Extensions can run in private windows. Each extension's chrome://extensions settings are now yours to set: whether it runs in private windows and on local files, whether it may run user scripts, and which sites it runs on (when you click it, on specific sites, or on all sites). Set them in the config's `extensions.settings`, by extension id, or in the Settings app, which shows the ones an extension can use while it is on and moves Options and Uninstall to the bottom of its row. A setting the config drops goes back to Chrome's default.
- 133ce8a: Browser profiles have an order. The config's `browser.order` lists profile ids, and the profiles it leaves out follow by id. The compositor sends the profiles in that order, so the profile menu and Settings list them that way.
  
  Settings' Profiles page moves a profile up or down. After its swatches, a color well takes any color, and the swatches now include the theme's cyan.
  
  In the profile menu, middle-clicking a profile opens the page in a new window of that profile, using `ListRow`'s new `onMiddlePress`. The profile button writes its name in black on light colors, where white would be hard to read.

### Patch Changes

- 6f4cabd: `EmptyState` draws its icon on a tinted disc, and takes `tone="warning"` with a `detail` tooltip and `layout="inline"`. Panels that showed a line of text when empty or unreadable use it, and Saved networks opens from a button beside the Wi-Fi switch.
- b7d85c0: Danger buttons draw white text in both themes, and a `dangerGhost` variant draws red text with no fill. Settings uses it for Uninstall in Extensions and Stop in Agents.
- d57e6f6: Settings shows each extension's own icon, on the Extensions page and on each profile's card, instead of its initial, which stays for an extension without one. A profile card lists its extensions in two columns at most, so their names fit. The engine's extension list names each extension's icon file, which `domicile-app-host` hands to Settings as an image.
- 996cc29: A shell can hear when nobody has been at the desk for a time it chooses (`session.idleAfter`), or a time before the screens blank (`session.idleBeforeBlanking`). These replace `session.idleWarnings` and the `idle.warn_before_seconds` setting, which are gone.
- c454256: A display profile can drive a monitor in HDR (HDR10) with `hdr: true`, and set how bright ordinary content's white is there with `sdr_white` (203 cd/m² by default). It is off by default and used only where the monitor's EDID takes PQ and its connector scans out in 10 bits. The SDK's config types gain both fields, and Settings reads profiles that set them instead of refusing them.
- 1cbbfb5: `Button` takes `label` on a text button as a longer name, such as "Forget Codex", and still draws it as text. Only an element child makes an icon-only button. Settings' Agents page draws Sign out, Forget and Stop with their padding again.
- 94e5909: Settings reads every key the compositor reads, such as `input.mouse`, `input.touchpad` and `terminal`, instead of refusing the config. Its schema is now `@domicile-desktop/sdk/config-schema`, a Zod schema generated from the compositor's config with its defaults filled in.
- e821d1f: A display profile can turn on adaptive sync (variable refresh rate, FreeSync, G-Sync Compatible) per monitor with `adaptive_sync: true`. It is off by default, asked for only where the monitor and driver report support, and retried without it when the driver refuses the modeset. The SDK's `Display` gains `adaptiveSync` (`unsupported`, `off` or `on`), which says what the hardware is doing. Settings now reads profiles that set `refresh` or `adaptive_sync` instead of refusing them.
- 539ce11: An agent that signs in, such as claude.ai, no longer asks for a code: its page waits while the desktop asks "Let Claude sign in to your desktop?", and **Allow** signs it in.
- 4b89923: Settings' Profiles page pads each profile's card the way the other pages' cards are padded, lists the default profile first and the default private one last, and gives extension names more room.
- 04baee9: Settings' Displays page can turn on HDR for each monitor in a profile and set
  how bright everyday content looks while it's on. On a narrow window, each
  monitor's settings stack into labeled lines.
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
- Updated dependencies [5fe0d76]
- Updated dependencies [6e41263]
- Updated dependencies [dec9fc2]
- Updated dependencies [6aad1fa]
  - @domicile-desktop/component-library@2.2.0
  - @domicile-desktop/sdk@3.0.0
  - @domicile-desktop/react@0.2.0

## 0.1.2

### Patch Changes

- af7415e: Hide the pointer while typing and after a pause in pointer input, with `theme.cursor_hide_when_typing` and `theme.cursor_hide_after_ms`. The next pointer move, click, scroll or touchpad gesture shows it again.
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
  - @domicile-desktop/react@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [fdad979]
  - @domicile-desktop/sdk@2.1.0
  - @domicile-desktop/component-library@2.0.1
  - @domicile-desktop/react@0.1.1

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
- 0bd0d2a: The desktop draws its text in Inter, which ships with it, instead of the computer's default sans-serif face. The manganese `font` option picks another installed face.
- Updated dependencies [bafd922]
- Updated dependencies [fe90bca]
- Updated dependencies [77fd631]
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
  - @domicile-desktop/react@0.1.0

## 0.0.1

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/sdk@1.0.0
