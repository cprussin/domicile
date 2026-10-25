# @domicile-desktop/system-network

## 1.1.0

### Minor Changes

- 558794b: The network item stays on the bar after a lock and when the network service fails, hiding only on a machine with no network hardware. It shows a cable that iwd or wpa_supplicant cannot report, and its panel lists each wired port with its speed, addresses and gateway. `system-network` adds `interfaces`: the hardware from `/sys/class/net` and addresses from `ip`, which the compositor's wrapper now puts on `PATH`.
- 1f1775a: The `system-*` libraries take `desktop(domicile)` instead of `system(domicile)`, and call its `files`, `processes` and `dbus` namespaces. Their host types are renamed to match: `NetworkSystem` is `NetworkDesktop`, `WifiSystem` is `WifiDesktop`, `InterfaceSystem` is `InterfaceDesktop`, `AudioSystem` is `AudioDesktop` and `SysfsSystem` is `SysfsDesktop`.

### Patch Changes

- ab2d2f0: The engine hands `Shell` the typed `Domicile` and an app's `main` the `AppDomicile`, built by the SDK's layer, which the engine bundles. Shells and apps no longer call `desktop()`/`appDesktop()`. The SDK drops `system()`, the portal watch helpers and `./appearance` from its public API; use the `Domicile` namespaces.
- 57b5b1f: A watch's and a D-Bus match's `items` are `Listened<T>`: `Listened.Heard(item)`, or `Listened.Missed()` after a compositor restart, when changes in between were not heard. The battery, Bluetooth, network, tray menu and icon theme readers read again then.
- 59b63cd: The network panel shows the Wi-Fi connection's addresses and gateway with every backend, lists each address on its own line at a fixed width so IPv6 addresses don't widen it, and leaves out deprecated IPv6 addresses.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- Updated dependencies [3980a9a]
- Updated dependencies [40f5af3]
- Updated dependencies [ab2d2f0]
- Updated dependencies [a88ce23]
- Updated dependencies [56e1c22]
- Updated dependencies [e42226f]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [44d0983]
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
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [b1041f8]
- Updated dependencies [20a1fc5]
- Updated dependencies [ee63a45]
- Updated dependencies [ca86667]
- Updated dependencies [ee1cc17]
  - @domicile-desktop/sdk@1.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/sdk@1.0.0
