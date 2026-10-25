# @domicile-desktop/manganese-bar-module-network

## 1.1.0

### Minor Changes

- 558794b: The network item stays on the bar after a lock and when the network service fails, hiding only on a machine with no network hardware. It shows a cable that iwd or wpa_supplicant cannot report, and its panel lists each wired port with its speed, addresses and gateway. `system-network` adds `interfaces`: the hardware from `/sys/class/net` and addresses from `ip`, which the compositor's wrapper now puts on `PATH`.

### Patch Changes

- 1caba05: Dimmed top bar items (muted, off, offline) keep the full hover background; only the icon dims.
- 59b63cd: The network panel shows the Wi-Fi connection's addresses and gateway with every backend, lists each address on its own line at a fixed width so IPv6 addresses don't widen it, and leaves out deprecated IPv6 addresses.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- 1d6f437: The network panel keeps the keyboard while open, so a Wi-Fi password typed into it no longer goes to the focused window.
- Updated dependencies [9e60e1e]
- Updated dependencies [6bbc80b]
- Updated dependencies [a88ce23]
- Updated dependencies [56e1c22]
- Updated dependencies [e42226f]
- Updated dependencies [00e5da2]
- Updated dependencies [b49fa3a]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [cd02e0e]
- Updated dependencies [57b5b1f]
- Updated dependencies [93f015d]
- Updated dependencies [558794b]
- Updated dependencies [59b63cd]
- Updated dependencies [e1205bb]
- Updated dependencies [8bc5b85]
- Updated dependencies [3146073]
- Updated dependencies [bbf849b]
- Updated dependencies [4759ab2]
- Updated dependencies [3bb9bd5]
- Updated dependencies [0f4582e]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [9fd298a]
- Updated dependencies [c4fe915]
- Updated dependencies [b39d80e]
- Updated dependencies [21b82af]
- Updated dependencies [427c184]
- Updated dependencies [113dabe]
- Updated dependencies [ee1cc17]
  - @domicile-desktop/manganese-bar@1.1.0
  - @domicile-desktop/manganese-host@1.1.0
  - @domicile-desktop/sdk@1.1.0
  - @domicile-desktop/component-library@1.1.0
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
