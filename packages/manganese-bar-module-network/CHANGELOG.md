# @domicile-desktop/manganese-bar-module-network

## 1.1.0

### Minor Changes

- 558794b: The network item stays on the bar after a lock and when the network service fails, hiding only on a machine with no network hardware. It shows a cable that iwd or wpa_supplicant cannot report, and its panel lists each wired port with its speed, addresses and gateway. `system-network` adds `interfaces`: the hardware from `/sys/class/net` and addresses from `ip`, which the compositor's wrapper now puts on `PATH`.

### Patch Changes

- 1caba05: Dimmed top bar items (muted, off, offline) keep the full hover background; only the icon dims.
- 59b63cd: The network panel shows the Wi-Fi connection's addresses and gateway with every backend, lists each address on its own line at a fixed width so IPv6 addresses don't widen it, and leaves out deprecated IPv6 addresses.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- 1f1775a: The `system-*` libraries take `desktop(domicile)` instead of `system(domicile)`, and call its `files`, `processes` and `dbus` namespaces. Their host types are renamed to match: `NetworkSystem` is `NetworkDesktop`, `WifiSystem` is `WifiDesktop`, `InterfaceSystem` is `InterfaceDesktop`, `AudioSystem` is `AudioDesktop` and `SysfsSystem` is `SysfsDesktop`.
- 1d6f437: The network panel keeps the keyboard while open, so a Wi-Fi password typed into it no longer goes to the focused window.
- Updated dependencies [9e60e1e]
- Updated dependencies [6bbc80b]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [40f5af3]
- Updated dependencies [a88ce23]
- Updated dependencies [56e1c22]
- Updated dependencies [e42226f]
- Updated dependencies [506b12f]
- Updated dependencies [00e5da2]
- Updated dependencies [b49fa3a]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [44d0983]
- Updated dependencies [cd02e0e]
- Updated dependencies [57b5b1f]
- Updated dependencies [b2c6fd5]
- Updated dependencies [93f015d]
- Updated dependencies [558794b]
- Updated dependencies [59b63cd]
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
- Updated dependencies [1f1775a]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [9fd298a]
- Updated dependencies [c4fe915]
- Updated dependencies [20a1fc5]
- Updated dependencies [b39d80e]
- Updated dependencies [21b82af]
- Updated dependencies [427c184]
- Updated dependencies [ee63a45]
- Updated dependencies [113dabe]
- Updated dependencies [b241f68]
- Updated dependencies [ca86667]
- Updated dependencies [ee1cc17]
  - @domicile-desktop/manganese-bar@1.1.0
  - @domicile-desktop/manganese-host@1.1.0
  - @domicile-desktop/component-library@1.1.0
  - @domicile-desktop/sdk@1.1.0
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
