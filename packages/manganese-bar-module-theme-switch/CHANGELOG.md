# @domicile-desktop/manganese-bar-module-theme-switch

## 1.1.0

### Minor Changes

- 341debf: Quick settings: one bar item (`@domicile-desktop/manganese/QuickSettings`) replaces the theme, keep awake, brightness, volume, Bluetooth, network and battery items in `DEFAULT_BAR` and `LOCK_BAR`. Its button shows the network, sound and battery, plus the eye while the screens are kept on and Bluetooth while a device is connected. Its panel has labeled tiles (Wi-Fi or Wired, Bluetooth, Keep awake, Night light, Dark mode), the brightness and volume sliders, and the battery in words with the time left, and a Settings button. A tile's arrow opens the item's panel in place. Each hardware item exports its parts as `./quick-settings`; the component library adds `QuickTile`, and `system-battery` reads UPower's `TimeToEmpty` as `secondsLeft`.

### Patch Changes

- a9a62e8: The quick settings Dark mode switch wipes over to its new state with the rest of the screen. `useTheme` adds `painted`, the theme the page is drawn in.
- 7a29c8f: Icons in the bar, quick settings and level notices move when their state changes or they are pointed at: the bell swings, Wi-Fi arcs fill out, Bluetooth dots slide out, speaker waves pulse, a slash draws across what is off, the dark mode sun turns to a moon, and more. New `Animated*Icon` components and `_controlHover` / `_controlActive` conditions in the component library. The notifications bar item no longer exports a Panda preset.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- f4a973d: Quick settings: Wi-Fi and Bluetooth tiles open their panels instead of switching; Keep awake, Night light and Dark mode become a row of switches (`QuickToggle`). The network panel groups by Wired and Wi-Fi with details folded away (`ListRow` `disclosure`). Sound lists outputs and inputs by port name to pick from.
- Updated dependencies [bafd922]
- Updated dependencies [77fd631]
- Updated dependencies [923e65b]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [c7a232d]
- Updated dependencies [9d0934e]
- Updated dependencies [a9a62e8]
- Updated dependencies [fa78a81]
- Updated dependencies [509f948]
- Updated dependencies [a2ee8ea]
- Updated dependencies [ab2d2f0]
- Updated dependencies [0e8c788]
- Updated dependencies [258d9aa]
- Updated dependencies [14e6071]
- Updated dependencies [56e1c22]
- Updated dependencies [506b12f]
- Updated dependencies [00e5da2]
- Updated dependencies [75b9403]
- Updated dependencies [3f7e261]
- Updated dependencies [b49fa3a]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [7a29c8f]
- Updated dependencies [4967b5d]
- Updated dependencies [be59aae]
- Updated dependencies [44d0983]
- Updated dependencies [6825067]
- Updated dependencies [cd02e0e]
- Updated dependencies [840418d]
- Updated dependencies [e1205bb]
- Updated dependencies [670713c]
- Updated dependencies [8bc5b85]
- Updated dependencies [4ee2c21]
- Updated dependencies [3146073]
- Updated dependencies [e83ec4a]
- Updated dependencies [7a786a4]
- Updated dependencies [4759ab2]
- Updated dependencies [0f4582e]
- Updated dependencies [d80e2f5]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [4064278]
- Updated dependencies [f4a973d]
- Updated dependencies [341debf]
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [c4fe915]
- Updated dependencies [b39d80e]
- Updated dependencies [21b82af]
- Updated dependencies [427c184]
- Updated dependencies [ee63a45]
- Updated dependencies [5a6a4fc]
- Updated dependencies [113dabe]
- Updated dependencies [0bd0d2a]
- Updated dependencies [570e7bb]
- Updated dependencies [2edc3c1]
- Updated dependencies [b241f68]
- Updated dependencies [6c3db42]
- Updated dependencies [63728a9]
  - @domicile-desktop/component-library@1.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
