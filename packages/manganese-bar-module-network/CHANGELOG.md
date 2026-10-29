# @domicile-desktop/manganese-bar-module-network

## 1.1.0

### Minor Changes

- 558794b: The network item stays on the bar after a lock and when the network service fails, hiding only on a machine with no network hardware. It shows a cable that iwd or wpa_supplicant cannot report, and its panel lists each wired port with its speed, addresses and gateway. `system-network` adds `interfaces`: the hardware from `/sys/class/net` and addresses from `ip`, which the compositor's wrapper now puts on `PATH`.
- 341debf: Quick settings: one bar item (`@domicile-desktop/manganese/QuickSettings`) replaces the theme, keep awake, brightness, volume, Bluetooth, network and battery items in `DEFAULT_BAR` and `LOCK_BAR`. Its button shows the network, sound and battery, plus the eye while the screens are kept on and Bluetooth while a device is connected. Its panel has labeled tiles (Wi-Fi or Wired, Bluetooth, Keep awake, Night light, Dark mode), the brightness and volume sliders, and the battery in words with the time left, and a Settings button. A tile's arrow opens the item's panel in place. Each hardware item exports its parts as `./quick-settings`; the component library adds `QuickTile`, and `system-battery` reads UPower's `TimeToEmpty` as `secondsLeft`.

### Patch Changes

- 77fd631: A bar button stays lit while the panel it opened is open. New `fillOverPhoto` color and `_hoverOrOpen` condition.
- 1caba05: Dimmed top bar items (muted, off, offline) keep the full hover background; only the icon dims.
- 923e65b: Top bar tooltips are design-system tooltips: a frosted pill under the item that stays on its screen. `Tooltip` takes a `tone`, and `Popover` takes a `tooltip` for its trigger.
- 7a29c8f: Icons in the bar, quick settings and level notices move when their state changes or they are pointed at: the bell swings, Wi-Fi arcs fill out, Bluetooth dots slide out, speaker waves pulse, a slash draws across what is off, the dark mode sun turns to a moon, and more. New `Animated*Icon` components and `_controlHover` / `_controlActive` conditions in the component library. The notifications bar item no longer exports a Panda preset.
- 59b63cd: The network panel shows the Wi-Fi connection's addresses and gateway with every backend, lists each address on its own line at a fixed width so IPv6 addresses don't widen it, and leaves out deprecated IPv6 addresses.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- e83ec4a: Bar panels never show blank. New `EmptyState` and `Loading` panel parts: Wi-Fi, Bluetooth, Sound, notifications and inboxes say when they are off, empty or still checking, and Bluetooth says when it couldn't be read.
- 7a786a4: Quick settings, its Wi-Fi, Bluetooth and Sound details, and the notifications panel are built from shared panel parts (`Panel`, `PanelHeader`, `PanelSection`, `ListRow`, `DetailList`, `SliderRow`, `PanelNote`, `PanelFooter`, `IconButton`) with one type scale and set of colors, so they line up and nothing spills out of its panel. Bluetooth devices are grouped as connected, paired and nearby; refusals say what failed in plain words; and a panel opened with the pointer no longer shows a focus ring on its first control.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- 1f1775a: The `system-*` libraries take `desktop(domicile)` instead of `system(domicile)`, and call its `files`, `processes` and `dbus` namespaces. Their host types are renamed to match: `NetworkSystem` is `NetworkDesktop`, `WifiSystem` is `WifiDesktop`, `InterfaceSystem` is `InterfaceDesktop`, `AudioSystem` is `AudioDesktop` and `SysfsSystem` is `SysfsDesktop`.
- f4a973d: Quick settings: Wi-Fi and Bluetooth tiles open their panels instead of switching; Keep awake, Night light and Dark mode become a row of switches (`QuickToggle`). The network panel groups by Wired and Wi-Fi with details folded away (`ListRow` `disclosure`). Sound lists outputs and inputs by port name to pick from.
- 1971d87: React hooks for system state. Each `system-*` package has a `/react` with hooks and one watch per desktop: `useBattery`, `useBluetooth`, `useNetwork`, `useWifi`, `useAudio` and more. `@domicile-desktop/react` gains the shared watches (`sharedWatch`, `perDesktop`, `useSharedWatch`, `useDeskWatch`, `watchPresence`). manganese-host's `domicile-context`, `per-host`, `shared-watch`, `useSharedWatch` and `watch-presence` move there, and manganese uses `<DomicileProvider>`.
- 1d6f437: The network panel keeps the keyboard while open, so a Wi-Fi password typed into it no longer goes to the focused window.
- Updated dependencies [bafd922]
- Updated dependencies [77fd631]
- Updated dependencies [9e60e1e]
- Updated dependencies [6bbc80b]
- Updated dependencies [923e65b]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [c7a232d]
- Updated dependencies [a9a62e8]
- Updated dependencies [509f948]
- Updated dependencies [c03a44b]
- Updated dependencies [40f5af3]
- Updated dependencies [ab2d2f0]
- Updated dependencies [17064a7]
- Updated dependencies [a88ce23]
- Updated dependencies [0e8c788]
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
- Updated dependencies [7a29c8f]
- Updated dependencies [4967b5d]
- Updated dependencies [be59aae]
- Updated dependencies [44d0983]
- Updated dependencies [cd02e0e]
- Updated dependencies [57b5b1f]
- Updated dependencies [b2c6fd5]
- Updated dependencies [93f015d]
- Updated dependencies [b85d9bb]
- Updated dependencies [01b9340]
- Updated dependencies [558794b]
- Updated dependencies [59b63cd]
- Updated dependencies [fccc784]
- Updated dependencies [e1205bb]
- Updated dependencies [670713c]
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
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [1f1775a]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [4064278]
- Updated dependencies [f4a973d]
- Updated dependencies [341debf]
- Updated dependencies [ae7874c]
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
- Updated dependencies [66bfb0d]
- Updated dependencies [113dabe]
- Updated dependencies [1971d87]
- Updated dependencies [2edc3c1]
- Updated dependencies [b241f68]
- Updated dependencies [6c3db42]
- Updated dependencies [9c89f16]
- Updated dependencies [ca86667]
- Updated dependencies [ee1cc17]
- Updated dependencies [eb6b52a]
- Updated dependencies [63728a9]
  - @domicile-desktop/component-library@1.1.0
  - @domicile-desktop/manganese-bar@1.1.0
  - @domicile-desktop/manganese-host@2.0.0
  - @domicile-desktop/sdk@1.1.0
  - @domicile-desktop/react@0.1.0
  - @domicile-desktop/system-network@1.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/manganese-host@1.0.0
  - @domicile-desktop/sdk@1.0.0
  - @domicile-desktop/system-network@1.0.0
