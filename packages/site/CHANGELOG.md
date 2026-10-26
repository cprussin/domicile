# @domicile-desktop/site

## 0.0.2

### Patch Changes

- 1161efd: `domicile --help` (or `-h`, `help`, or `<verb> --help`) lists every command.
- 64ffcb7: `domicile theme [light|dark|toggle]` switches the desktop's theme from a terminal, or prints it. It works with any shell and needs no pointer.
- 56dd6c1: The manganese tour describes its new captures.
- e455955: `domicile open <file|folder|url>` opens anything: a web link in a browser window, anything else with its type's default from `mimeapps.list`, supertypes counted (a `text/plain` default opens Markdown and source code). `domicile open --app <url|module>` opens a site or app module as an app. Domicile's `xdg-open` and the launcher's Enter run it, so apps, terminals and the launcher agree. `open-url`, `open-app` and `run-app` are gone: use `open` and `open --app`.
- ab2d2f0: The engine hands `Shell` the typed `Domicile` and an app's `main` the `AppDomicile`, built by the SDK's layer, which the engine bundles. Shells and apps no longer call `desktop()`/`appDesktop()`. The SDK drops `system()`, the portal watch helpers and `./appearance` from its public API; use the `Domicile` namespaces.
- 75b9403: Ghost and other buttons in Settings, History and the site lose the outline they drew when not focused. The preset now sets the page's color scheme, light or dark, so packages no longer replace its `html` rules. A switch in Settings says "Off" when it is off.
- b1041f8: The last package-specific scripts leave `scripts/`: `dev-shell` becomes a package the shells' `start:dev` runs, docs media capture moves into the site, `update-engine-release.sh` and the IDL check into the engine, and `smoke-compositor.sh` into the e2e harness.
- 5f8475c: Domicile page: a "Batteries included" section, a section on desktop apps, and cards in the hero that jump to the main sections.
- 1b6c11c: Docs pages: the manganese user guide, rendered from the repository's markdown under `/docs/`.
- cc050c2: Give the real apt, dnf and zypper setup on the install tabs.
- b4d7504: Add a command line section led by `domicile load-shell`, show a short example under each SDK feature, and trim the Chromium talk.
- Updated dependencies [bafd922]
- Updated dependencies [923e65b]
- Updated dependencies [44eb13c]
- Updated dependencies [3980a9a]
- Updated dependencies [ab2d2f0]
- Updated dependencies [14e6071]
- Updated dependencies [56e1c22]
- Updated dependencies [506b12f]
- Updated dependencies [00e5da2]
- Updated dependencies [75b9403]
- Updated dependencies [3f7e261]
- Updated dependencies [b49fa3a]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [44d0983]
- Updated dependencies [cd02e0e]
- Updated dependencies [e1205bb]
- Updated dependencies [670713c]
- Updated dependencies [8bc5b85]
- Updated dependencies [3146073]
- Updated dependencies [4759ab2]
- Updated dependencies [0f4582e]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [c4fe915]
- Updated dependencies [b39d80e]
- Updated dependencies [21b82af]
- Updated dependencies [427c184]
- Updated dependencies [ee63a45]
- Updated dependencies [113dabe]
- Updated dependencies [b241f68]
  - @domicile-desktop/component-library@1.1.0
