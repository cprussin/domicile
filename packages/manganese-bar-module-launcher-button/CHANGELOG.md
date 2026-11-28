# @domicile-desktop/manganese-bar-module-launcher-button

## 1.1.2

### Patch Changes

- e33f628: The bar's buttons share one `barButton` Panda pattern, from `@domicile-desktop/manganese-bar/panda-preset`. A package whose CSS a shell emits can take its Panda config from `packagePandaConfig` in `@domicile-desktop/component-library/panda-package-config`.
- fb2d9c3: Move the shell's surfaces onto the `springs.*` tokens:
  
  - `Popover` grows from its trigger, and `ModalDialog` takes an `origin` (or a `DialogOrigin` around it) to spring from and back into. Portal dialogs and the file picker spring from the window that asked, and the launcher from the bar button that opened it.
  - `SlideOver`, `Toaster` and `LevelToast` move on springs; a swiped toast leaves at the speed it was let go.
  - What is in a `ListRow` drawer fades and slides into place on springs.
  - Menus, `Select` lists and tooltips fade in rising 2px off their anchor.
  - The region picker's corners snap out on a spring when let go, and the recording toolbar springs in.
  - The lock's clock and field, page dialogs and the workspace switcher's highlight move on springs.
- Updated dependencies [0034f1d]
- Updated dependencies [8ab0523]
- Updated dependencies [db55f37]
- Updated dependencies [1fce39d]
- Updated dependencies [50b429c]
- Updated dependencies [0966517]
- Updated dependencies [e33f628]
- Updated dependencies [bf4e447]
- Updated dependencies [88a71a0]
- Updated dependencies [525150c]
- Updated dependencies [02e8509]
- Updated dependencies [cc64389]
- Updated dependencies [b9abd20]
- Updated dependencies [c8a08d4]
- Updated dependencies [a64fb76]
- Updated dependencies [fb2d9c3]
- Updated dependencies [6f8fea2]
- Updated dependencies [c8a08d4]
- Updated dependencies [96b06ae]
- Updated dependencies [4d479d1]
- Updated dependencies [0bf1cdc]
- Updated dependencies [dc1279f]
- Updated dependencies [68fe399]
- Updated dependencies [9c59e57]
- Updated dependencies [3cc9d3d]
  - @domicile-desktop/component-library@3.0.0
  - @domicile-desktop/manganese-launcher@1.3.0

## 1.1.1

### Patch Changes

- Updated dependencies [6f4cabd]
- Updated dependencies [02fe478]
- Updated dependencies [b7d85c0]
- Updated dependencies [394ecc7]
- Updated dependencies [2794947]
- Updated dependencies [d194a0d]
- Updated dependencies [ce56535]
- Updated dependencies [3977a25]
- Updated dependencies [a9b83d4]
- Updated dependencies [728d513]
- Updated dependencies [86c57d9]
- Updated dependencies [046d172]
- Updated dependencies [dba9a81]
- Updated dependencies [382819f]
- Updated dependencies [befeb71]
- Updated dependencies [4a4f057]
- Updated dependencies [5b3650f]
- Updated dependencies [2bf4b1b]
- Updated dependencies [1cbbfb5]
- Updated dependencies [adb0ef5]
- Updated dependencies [28238ca]
- Updated dependencies [69247ca]
- Updated dependencies [4799f21]
- Updated dependencies [14704ae]
- Updated dependencies [3600d3b]
- Updated dependencies [9bd54ab]
- Updated dependencies [dabcc0c]
- Updated dependencies [8eb261d]
- Updated dependencies [133ce8a]
- Updated dependencies [b95da52]
- Updated dependencies [5fe0d76]
- Updated dependencies [6e41263]
  - @domicile-desktop/component-library@2.2.0
  - @domicile-desktop/manganese-launcher@1.2.0

## 1.1.0

### Minor Changes

- 62ccd23: Manganese has an overview: each monitor's workspaces at once, with their live windows. Open it with Meta+O, a four-finger pinch in, or the new button before the workspaces in the bar. Click a workspace or a window to go there, or drag a window onto another workspace to move it. A four-finger pinch out opens the launcher, whose button now shows a sparkle that twinkles when pointed at. The component library adds `AnimatedSparkleIcon`.

### Patch Changes

- Updated dependencies [f9bbf5d]
- Updated dependencies [62ccd23]
- Updated dependencies [c1988f7]
- Updated dependencies [e81703a]
- Updated dependencies [3d22f74]
- Updated dependencies [75708d7]
- Updated dependencies [50318b4]
- Updated dependencies [eeb9468]
  - @domicile-desktop/component-library@2.1.0
  - @domicile-desktop/manganese-launcher@1.1.2

## 1.0.2

### Patch Changes

- 20f560e: Show the launcher button's whole hover background instead of cutting off its end.
- @domicile-desktop/component-library@2.0.1
  - @domicile-desktop/manganese-launcher@1.1.1

## 1.0.1

### Patch Changes

- 77fd631: A bar button stays lit while the panel it opened is open. New `fillOverPhoto` color and `_hoverOrOpen` condition.
- 923e65b: Top bar tooltips are design-system tooltips: a frosted pill under the item that stays on its screen. `Tooltip` takes a `tone`, and `Popover` takes a `tooltip` for its trigger.
- 7a29c8f: Icons in the bar, quick settings and level notices move when their state changes or they are pointed at: the bell swings, Wi-Fi arcs fill out, Bluetooth dots slide out, speaker waves pulse, a slash draws across what is off, the dark mode sun turns to a moon, and more. New `Animated*Icon` components and `_controlHover` / `_controlActive` conditions in the component library. The notifications bar item no longer exports a Panda preset.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- 44f23d6: The top bar is easier to read: the clock is larger, workspaces are numbers with the current one on a lit square instead of a white disc, and bar buttons light up as rounded squares like the rest of the desktop.
- Updated dependencies [bafd922]
- Updated dependencies [77fd631]
- Updated dependencies [a62f35a]
- Updated dependencies [923e65b]
- Updated dependencies [cb4d2f9]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [c7a232d]
- Updated dependencies [66d220b]
- Updated dependencies [a2def76]
- Updated dependencies [eca2588]
- Updated dependencies [f15f43a]
- Updated dependencies [7c8d9e2]
- Updated dependencies [fc3ee2f]
- Updated dependencies [9d0934e]
- Updated dependencies [a9a62e8]
- Updated dependencies [fa78a81]
- Updated dependencies [509f948]
- Updated dependencies [a2ee8ea]
- Updated dependencies [c80cd2a]
- Updated dependencies [e455955]
- Updated dependencies [f71cc09]
- Updated dependencies [aeb6f92]
- Updated dependencies [ab2d2f0]
- Updated dependencies [0e8c788]
- Updated dependencies [a1569c6]
- Updated dependencies [6fecbbd]
- Updated dependencies [258d9aa]
- Updated dependencies [d9f5353]
- Updated dependencies [fb9e591]
- Updated dependencies [14e6071]
- Updated dependencies [56e1c22]
- Updated dependencies [54472b5]
- Updated dependencies [506b12f]
- Updated dependencies [00e5da2]
- Updated dependencies [75b9403]
- Updated dependencies [3f7e261]
- Updated dependencies [b49fa3a]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [2d2289b]
- Updated dependencies [7a29c8f]
- Updated dependencies [a113605]
- Updated dependencies [4967b5d]
- Updated dependencies [be59aae]
- Updated dependencies [44d0983]
- Updated dependencies [7ac9e00]
- Updated dependencies [f18b865]
- Updated dependencies [dc90c70]
- Updated dependencies [5bdc699]
- Updated dependencies [6825067]
- Updated dependencies [cd02e0e]
- Updated dependencies [840418d]
- Updated dependencies [7aa450b]
- Updated dependencies [a472a59]
- Updated dependencies [e1205bb]
- Updated dependencies [40d7378]
- Updated dependencies [670713c]
- Updated dependencies [cd52ce3]
- Updated dependencies [e7cbd52]
- Updated dependencies [8bc5b85]
- Updated dependencies [4ee2c21]
- Updated dependencies [3146073]
- Updated dependencies [e83ec4a]
- Updated dependencies [7a786a4]
- Updated dependencies [4759ab2]
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
- Updated dependencies [599d60f]
- Updated dependencies [74a9564]
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [c4fe915]
- Updated dependencies [065ff4b]
- Updated dependencies [1e2aeca]
- Updated dependencies [b39d80e]
- Updated dependencies [21b82af]
- Updated dependencies [427c184]
- Updated dependencies [ee63a45]
- Updated dependencies [5a6a4fc]
- Updated dependencies [25b9bd3]
- Updated dependencies [113dabe]
- Updated dependencies [0bd0d2a]
- Updated dependencies [b741b92]
- Updated dependencies [570e7bb]
- Updated dependencies [2edc3c1]
- Updated dependencies [b241f68]
- Updated dependencies [5d2376e]
- Updated dependencies [6c3db42]
- Updated dependencies [8b5c0ca]
- Updated dependencies [63728a9]
  - @domicile-desktop/component-library@2.0.0
  - @domicile-desktop/manganese-launcher@1.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/manganese-launcher@1.0.0
