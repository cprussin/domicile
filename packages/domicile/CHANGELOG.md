# domicile

## 1.0.0

### Major Changes

- 2056529: The first release.

### Minor Changes

- e90c8ad: On a tty, a touchpad ignores input while a keyboard types. `domicile disable-while-typing [on|off|toggle]` turns it off and on.

### Patch Changes

- d32d8f7: A `domicile://` page can `fetch()` its own files, and only its own.
- 0bf1018: The boot splash crossfades straight into the shell instead of through a white page.
- Updated dependencies [2056529]
- Updated dependencies [0ff84ad]
- Updated dependencies [0bf1018]
  - @domicile-desktop/manganese@1.0.0
  - @domicile-desktop/builder@0.0.1
  - @domicile-desktop/shell-simple@0.0.1
  - @domicile-desktop/app-history@0.0.1
  - @domicile-desktop/app-settings@0.0.1
  - @domicile-desktop/shell-splash@0.0.1
