# @domicile-desktop/manganese-bar-module-gmail

## 1.1.0

### Minor Changes

- 690c592: The Gmail item reads the inbox 1 and 5 seconds after a Gmail window opens, closes, navigates or changes title, so it follows the mail you read. It polls every 30 seconds instead of every minute.

### Patch Changes

- 9e60e1e: The bar's right-hand items are spaced evenly and a little wider apart: the battery readout is inset like the icon buttons around it. The Gmail counter keeps its text clear of its rounded ends.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
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
  - @domicile-desktop/manganese-host@1.1.0
  - @domicile-desktop/sdk@1.1.0
  - @domicile-desktop/component-library@1.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.
- 0ff84ad: The Gmail item reads the inbox with the Gmail API and signs in with OAuth. It takes a `client` prop: a Google Cloud OAuth client of the Desktop app type.

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/component-library@1.0.0
  - @domicile-desktop/manganese-host@1.0.0
  - @domicile-desktop/sdk@1.0.0
