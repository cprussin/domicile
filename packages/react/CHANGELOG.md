# @domicile-desktop/react

## 0.2.0

### Minor Changes

- cd75f9a: Picture-in-picture video works: a video's picture-in-picture button, or a site's, floats the video over your windows in the corner of its screen. Drag it to move it, drag an edge to resize it, and point at it for play, pause, track, back-to-tab and close controls. Shells list the videos in `domicile.pictureInPicture` and show one with `<app picture-in-picture="id">`.
- befeb71: Gmail and Messages inboxes, the Gmail bar module and launcher bookmarks take a `profile`, the browser profile they open in, so two Gmail accounts can live in two profiles. A site's app window is now in a browser profile, its site's by default, and `domicile open --app --profile <id>`, `browser.openApp(url, { profile })` and `browser.fetch(url, { profile })` pick one.

### Patch Changes

- Updated dependencies [7680c50]
- Updated dependencies [9478a19]
- Updated dependencies [87ac040]
- Updated dependencies [394ecc7]
- Updated dependencies [8f74f44]
- Updated dependencies [d3978bb]
- Updated dependencies [2794947]
- Updated dependencies [0e71fa1]
- Updated dependencies [f5fbd04]
- Updated dependencies [4acd3cd]
- Updated dependencies [d0fbc5b]
- Updated dependencies [03dcccf]
- Updated dependencies [996cc29]
- Updated dependencies [5ef4689]
- Updated dependencies [3e37020]
- Updated dependencies [2a1913f]
- Updated dependencies [cd75f9a]
- Updated dependencies [d2a68f5]
- Updated dependencies [c454256]
- Updated dependencies [09a3ad4]
- Updated dependencies [3bdac3b]
- Updated dependencies [f268f2d]
- Updated dependencies [fb07c3f]
- Updated dependencies [24b88fb]
- Updated dependencies [81215c5]
- Updated dependencies [d566f68]
- Updated dependencies [86c57d9]
- Updated dependencies [057faa5]
- Updated dependencies [51a769e]
- Updated dependencies [52e71af]
- Updated dependencies [5a70826]
- Updated dependencies [5c11ddc]
- Updated dependencies [8c477cc]
- Updated dependencies [382819f]
- Updated dependencies [befeb71]
- Updated dependencies [4a4f057]
- Updated dependencies [ebfad4b]
- Updated dependencies [5a896a8]
- Updated dependencies [69247ca]
- Updated dependencies [94e5909]
- Updated dependencies [bc8db8f]
- Updated dependencies [e821d1f]
- Updated dependencies [46d7737]
- Updated dependencies [8ff882e]
- Updated dependencies [0a4d218]
- Updated dependencies [9c805c4]
- Updated dependencies [9bd54ab]
- Updated dependencies [a2cab16]
- Updated dependencies [d6373e3]
- Updated dependencies [09be8b7]
- Updated dependencies [da632d6]
- Updated dependencies [85ad296]
- Updated dependencies [539ce11]
- Updated dependencies [e4f3394]
- Updated dependencies [e7b707c]
- Updated dependencies [8a2777f]
- Updated dependencies [756c1bd]
- Updated dependencies [133ce8a]
- Updated dependencies [b95da52]
- Updated dependencies [9478a19]
- Updated dependencies [a85afe8]
- Updated dependencies [25522ef]
- Updated dependencies [19cc2c5]
- Updated dependencies [a5ade39]
- Updated dependencies [5315b06]
- Updated dependencies [6e41263]
- Updated dependencies [dec9fc2]
- Updated dependencies [6aad1fa]
  - @domicile-desktop/sdk@3.0.0

## 0.1.2

### Patch Changes

- Updated dependencies [c664ef4]
- Updated dependencies [1af639c]
- Updated dependencies [eba7d0d]
- Updated dependencies [af7415e]
- Updated dependencies [bb1e4cb]
- Updated dependencies [d69b2f4]
- Updated dependencies [8eaae53]
- Updated dependencies [f592184]
- Updated dependencies [18413ff]
- Updated dependencies [69fe0d8]
- Updated dependencies [a354497]
- Updated dependencies [9246b97]
- Updated dependencies [cdb3534]
  - @domicile-desktop/sdk@2.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [fdad979]
  - @domicile-desktop/sdk@2.1.0

## 0.1.0

### Minor Changes

- c03a44b: New `@domicile-desktop/react`: `mount(App)` makes a shell's `Shell` or an app's `main`; `<DomicileProvider>`, `useDomicile`, `useAppDomicile`, `useWatch`, hooks for windows, displays, appearance, session and portals, and `<FakeDomicile>` for tests. The simple shell and the History and Settings apps mount with it.
- 01b9340: `<NestedShell shell>` (`@domicile-desktop/react/nested-shell`) runs another shell inside this one, on the same desktop.
- 1971d87: React hooks for system state. Each `system-*` package has a `/react` with hooks and one watch per desktop: `useBattery`, `useBluetooth`, `useNetwork`, `useWifi`, `useAudio` and more. `@domicile-desktop/react` gains the shared watches (`sharedWatch`, `perDesktop`, `useSharedWatch`, `useDeskWatch`, `watchPresence`). manganese-host's `domicile-context`, `per-host`, `shared-watch`, `useSharedWatch` and `watch-presence` move there, and manganese uses `<DomicileProvider>`.

### Patch Changes

- 22844b3: Docs audit: Wayland-only app support and the apps we check, the config schema served from domicile-desktop.com, locking in a `nix run` trial, portal requests a shell must answer, a complete packaging example, GPU troubleshooting for users, a NixOS flake example, differences from Chrome, and contributor-only sections labeled in the package references.
- ae7874c: `@domicile-desktop/react/elements` types the engine's `<app>` and `<webview>` in JSX, so a React shell writes `<app app-id={…} />` without declaring it.
- Updated dependencies [fe90bca]
- Updated dependencies [3980a9a]
- Updated dependencies [66d220b]
- Updated dependencies [d3a65c5]
- Updated dependencies [eca2588]
- Updated dependencies [22844b3]
- Updated dependencies [9fe15f8]
- Updated dependencies [40f5af3]
- Updated dependencies [ab2d2f0]
- Updated dependencies [17064a7]
- Updated dependencies [a88ce23]
- Updated dependencies [ecd3fba]
- Updated dependencies [0e8c788]
- Updated dependencies [62a671f]
- Updated dependencies [56e1c22]
- Updated dependencies [98d378e]
- Updated dependencies [e42226f]
- Updated dependencies [35b8470]
- Updated dependencies [6730912]
- Updated dependencies [2a87739]
- Updated dependencies [a999398]
- Updated dependencies [9d4a876]
- Updated dependencies [44d0983]
- Updated dependencies [57b5b1f]
- Updated dependencies [b2c6fd5]
- Updated dependencies [93f015d]
- Updated dependencies [b85d9bb]
- Updated dependencies [fccc784]
- Updated dependencies [2bf4b18]
- Updated dependencies [3146073]
- Updated dependencies [bbf849b]
- Updated dependencies [3bb9bd5]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [52a1d65]
- Updated dependencies [3e5b976]
- Updated dependencies [75799a0]
- Updated dependencies [2430e48]
- Updated dependencies [9fd298a]
- Updated dependencies [b1041f8]
- Updated dependencies [20a1fc5]
- Updated dependencies [ee63a45]
- Updated dependencies [66bfb0d]
- Updated dependencies [d9f5353]
- Updated dependencies [6c3db42]
- Updated dependencies [9c89f16]
- Updated dependencies [ca86667]
- Updated dependencies [0c58b28]
- Updated dependencies [ee1cc17]
- Updated dependencies [eb6b52a]
  - @domicile-desktop/sdk@2.0.0
