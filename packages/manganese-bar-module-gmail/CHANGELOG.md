# @domicile-desktop/manganese-bar-module-gmail

## 1.1.0

### Minor Changes

- 690c592: The Gmail item reads the inbox 1 and 5 seconds after a Gmail window opens, closes, navigates or changes title, so it follows the mail you read. It polls every 30 seconds instead of every minute.
- 3f7e261: Gmail's unread count is a badge on the item's end corner, like Messages and the notification bell; the item shows the inbox total. The badge is the new `CountBadge` component, which Messages and the bell now share. Messages caps its badge at "9+" and pops it in, as the bell does.

### Patch Changes

- 9e60e1e: The bar's right-hand items are spaced evenly and a little wider apart: the battery readout is inset like the icon buttons around it. The Gmail counter keeps its text clear of its rounded ends.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- c15ba93: Shells and manganese packages take the typed `Domicile` instead of the raw host. `PortalDialogs` takes `domicile` (no more `host`/`desktopOf`), `usePortalWallpaper` and manganese-host's helpers take `Domicile` slices, and the SDK's `bindKeys`, `fireGlobalShortcuts`, `watchShellOptions` and `casting` take namespaces. Adds `portals.fireShortcut`.
- Updated dependencies [6bbc80b]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [40f5af3]
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
  - @domicile-desktop/manganese-host@1.1.0
  - @domicile-desktop/component-library@1.1.0
  - @domicile-desktop/sdk@1.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.
- 0ff84ad: The Gmail item reads the inbox with the Gmail API and signs in with OAuth. It takes a `client` prop: a Google Cloud OAuth client of the Desktop app type.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/manganese-host@1.0.0
  - @domicile-desktop/sdk@1.0.0
