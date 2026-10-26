# @domicile-desktop/manganese-bar-module-brightness

## 1.1.0

### Minor Changes

- 6bbc80b: The battery, Bluetooth, brightness and volume items hide only on a machine without that hardware. With the hardware and no service to read it, each shows a dimmed icon saying so. The system libraries add `hardware`, which looks in `/sys`, and `manganese-host` adds `watch-presence`.
- 1ad2756: Volume, microphone and brightness keys show the new level in a notice on the focused screen.
- fccc784: Automatic brightness and a night light, as on macOS. The backlight follows the room's light from iio-sensor-proxy and learns from the levels the user sets. The night light warms every monitor from sunset to sunrise in the time zone's city, or on custom hours, with a switch in the brightness popover. Both are on by default and set in the Settings app's Shell page or under `shell_options`. Shells set the color temperature with `domicile.displays.setColorTemperature(kelvin)`.
- f8b1742: New manganese command, for a key or `domicile send-shell`: `night-light` toggles the night light, as the brightness popover's switch does.

### Patch Changes

- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- 1f1775a: The `system-*` libraries take `desktop(domicile)` instead of `system(domicile)`, and call its `files`, `processes` and `dbus` namespaces. Their host types are renamed to match: `NetworkSystem` is `NetworkDesktop`, `WifiSystem` is `WifiDesktop`, `InterfaceSystem` is `InterfaceDesktop`, `AudioSystem` is `AudioDesktop` and `SysfsSystem` is `SysfsDesktop`.
- Updated dependencies [6bbc80b]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [40f5af3]
- Updated dependencies [ab2d2f0]
- Updated dependencies [a88ce23]
- Updated dependencies [56e1c22]
- Updated dependencies [e42226f]
- Updated dependencies [506b12f]
- Updated dependencies [00e5da2]
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
- Updated dependencies [1f1775a]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
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
  - @domicile-desktop/manganese-host@1.1.0
  - @domicile-desktop/component-library@1.1.0
  - @domicile-desktop/sdk@1.1.0
  - @domicile-desktop/system-backlight@1.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/manganese-host@1.0.0
  - @domicile-desktop/sdk@1.0.0
  - @domicile-desktop/system-backlight@1.0.0
