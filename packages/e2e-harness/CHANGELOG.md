# @domicile-desktop/e2e-harness

## 0.1.0

### Minor Changes

- 81215c5: A shell can name any window to a capture tool. Each window's `toplevelId` and each browser window's `toplevelId` is its identifier on `ext-foreign-toplevel-list-v1`, so a shell can hand it to a tool such as `grim -T` instead of matching by title. The compositor sends a native window's on `app_appeared` and the browser windows' on `browser_toplevel_ids`.

### Patch Changes

- 0e71fa1: Games and VM viewers can confine the pointer to their window, or the part of it they name, and read raw mouse motion. On a console the engine holds its cursor inside the boxes the shell passes to the new `DomicileHost.confinePointer` (`pointer.confine` in the SDK), across monitors too; `DomicileWindow.pointerRegion` is the client's region. Relative motion now carries the mouse's unaccelerated deltas from libinput as `dx_unaccel`/`dy_unaccel`, so aiming no longer follows pointer acceleration, and a shell's warp still sends no motion. Manganese confines the pointer for the focused window that asks, and follows it as it moves.
- 23cbfe3: Add `domicile list-inputs [--json]`, which prints each keyboard, pointer and touch device the desktop reads: its kind, how it is attached, its USB or Bluetooth ids and its name. The engine reports the devices through a new `input_devices` callback.
- e4706b9: `domicile status` prints the shell, theme, keymap, lock, whether the screens
  are off, what keeps them on and what records or controls the desktop. `--json`
  for scripts.
- 10b47c9: `domicile devtools` sends a DevTools Protocol method to a browser window's page, from a short list that reads and drives the page, and `domicile mcp` offers agents browser tools on it: `browser_snapshot` reads the page's accessibility tree, and `browser_click`, `browser_type`, `browser_key`, `browser_navigate` and `browser_screenshot` act on its elements by ref. `list-windows` gives a browser window's `engine_id`. Private windows are never driven.
- 996cc29: A shell can hear when nobody has been at the desk for a time it chooses (`session.idleAfter`), or a time before the screens blank (`session.idleBeforeBlanking`). These replace `session.idleWarnings` and the `idle.warn_before_seconds` setting, which are gone.
- 52e71af: Private windows are a private browser profile's: its extension switches say what runs there. The config's `extensions.settings.<id>.private` is gone, and a config that sets it is refused; so are the SDK's `inPrivate` on installed extensions and in `configureExtension()`, and the Settings app's and tray's "Allow in private windows". The tray now shows the extensions of the last focused page's browser profile ("Extensions in Work"): its icons are those switched on there, and its switches switch them in that profile, locked where the config sets them.
- 5c11ddc: `domicile list-bindings` prints the running shell's keys and gestures in each
  binding mode and what they run. A shell command can now answer, and
  `domicile send-shell` prints the answer: Manganese's `get-workspaces` and
  `get-tree` answer with JSON, as `swaymsg -t get_workspaces` and `get_tree` do.
  
  Breaking: `onCommand` may return `Ok({ output })`;
  `shell.commands(help, bindings)` takes the bindings, which `bindKeys`
  describes for you; and `shell.answer(sent, ran)` takes the command's `Result`.
- 8e37f79: `domicile list-displays` prints each display with every name `sleep-displays`
  takes for it, its mode, layout, HDR and whether it is lit. `domicile
  list-windows` prints every window, native and browser alike. Both take
  `--json` for scripts.
- 60d225a: Add `domicile configure-display <display> <change>...`, which changes a monitor's mode, scale, position, rotation, adaptive sync, HDR and SDR white, or turns it on or off, until the desktop restarts, like `swaymsg output`. `reset` goes back to the config. The changes are laid over the profile that matches the plugged-in monitors, so a hotplug or a config edit keeps them.
- 321a9b0: Add `domicile lock`, `focus-window <id>`, `close-window <id>`, `kill-window <id>` and `inhibit-idle -- <command>`. The window commands take the ids `list-windows` prints. `focus-window` asks the shell to show and focus the window, the same request an app's activation makes. `inhibit-idle` keeps the screens on until the command exits.
- 8ff882e: Extensions can run in private windows. Each extension's chrome://extensions settings are now yours to set: whether it runs in private windows and on local files, whether it may run user scripts, and which sites it runs on (when you click it, on specific sites, or on all sites). Set them in the config's `extensions.settings`, by extension id, or in the Settings app, which shows the ones an extension can use while it is on and moves Options and Uninstall to the bottom of its row. A setting the config drops goes back to Chrome's default.
- ff5a1d0: `domicile list-windows` marks private browser windows, and its `--json`
  gives each browser window's address (`url`) and whether it is private.
- a2cab16: `domicile exec <program> [<arg>...]` and the SDK's `KeyAction.Exec` start a program for any shell, found on the desktop's `PATH`, and say why when it does not start; a key's failed start is a notification. Manganese's `exec` command is gone: its `exec()` builds `KeyAction.Exec`. `domicile drag` replaces `pointer press`/`release`, which let go as each command ended, and `domicile type` presses Return for a line break. The MCP server gains an `exec` tool, and its `drag` holds the button.
- 65e63db: Agents read and drive an Electron app's views, which `list-windows --json` lists under its window and `devtools --view` reaches, and `screenshot --fit --area` zooms into part of the desk.
- 6db9de5: A page's link for an app, such as Slack's `slack:` sign-in link, opens the app the desktop's prompt named. The engine's `xdg-open` is `domicile open`, as every app's is, and `domicile open` has the compositor start the app it picks, as the launcher does, so it gets the desktop's environment whoever asked.
- 09be8b7: Text fields in pages, web apps and Electron apps check spelling, in American English unless the config's `spellcheck.languages` says otherwise. The dictionaries ship with the engine and are never downloaded. A context menu event over a misspelled word carries `misspelledWord`, `spellingSuggestions` and `replaceMisspelling()`, and runs `add-to-dictionary`; manganese puts the suggestions at the top of the field's menu.
- 756c1bd: `domicile list-shell-commands` (also `send-shell --help`) prints the commands
  `send-shell` takes, as the running shell describes them. `send-shell` now fails
  with the shell's reason when the shell refuses a command or never says it ran
  it, instead of always succeeding.
  
  Breaking: `bindKeys` takes `commands`, describing what `onCommand` runs, and
  `onCommand` returns `Ok("ran")` or `Err(reason)`. `shell.commands(help)`
  replaces listening without a description, and `shell.answer(sent, refused)`
  reports how each command ended. Manganese describes all of its commands.
- a188e78: `domicile idle-time [--json]` prints how many seconds nobody has used the desktop. Electron apps read it for `powerMonitor.getSystemIdleTime` and `getSystemIdleState`, so Slack and the like can mark you away.
- dec9fc2: A page's `mailto:` link reaches the shell that claims `mailto:`, such as manganese's inbox picker. Chromium opens these links with `xdg-email`, and a desktop's `xdg-email` is `domicile-xdg-email`, which runs `domicile open` on the link its arguments make.
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

## 0.0.4

### Patch Changes

- af7415e: Hide the pointer while typing and after a pause in pointer input, with `theme.cursor_hide_when_typing` and `theme.cursor_hide_after_ms`. The next pointer move, click, scroll or touchpad gesture shows it again.
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

## 0.0.3

### Patch Changes

- Updated dependencies [fdad979]
  - @domicile-desktop/sdk@2.1.0

## 0.0.2

### Patch Changes

- 4432cb1: Adds `check-runner`, which runs a package's shell checks under turbo's `test:shell`; the skip scan moves to it from `e2e-harness`.
- e455955: `domicile open <file|folder|url>` opens anything: a web link in a browser window, anything else with its type's default from `mimeapps.list`, supertypes counted (a `text/plain` default opens Markdown and source code). `domicile open --app <url|module>` opens a site or app module as an app. Domicile's `xdg-open` and the launcher's Enter run it, so apps, terminals and the launcher agree. `open-url`, `open-app` and `run-app` are gone: use `open` and `open --app`.
- 0f04f3c: The end-to-end checks move from `scripts/` into the package's `tests/` and run in its `test:e2e`.
- a88ce23: The engine is a workspace package: its shell tests run in `test:shell`, and its checks against a built tree in `test:engine`.
- 56e1c22: File picker polish:
  
  - New folder button, and a Hidden files toggle (Ctrl+H).
  - The listing updates when the folder changes.
  - The save name box no longer walks a `/`.
  - No key help in the sidebar; full-size sidebar buttons.
  - Portal labels drop GTK's `_` access key marks ("_Save" shows as "Save").
  - `System.createDir` (`create_dir`) makes a directory. `FileRequest.list` is replaced by `FileRequest.folders` (`systemFolders` in `@domicile-desktop/component-library/folders`).
- e42226f: `theme.force_dark` names sites, such as `mail.google.com`, that the browser draws dark with Chromium's automatic dark mode while the theme is dark, for sites with no dark theme of their own.
- 44d0983: Switch keyboard layouts at runtime. `input.keyboard.keymaps` lists named keymaps; the first is the one the desktop starts on. The `keymap next` and `keymap <name>` commands switch every keyboard and show a toast, and the new `Keymap` bar item, in the default bar left of the theme toggle and on the lock screen, shows and switches it. The item's list and the toast show xkb's name for each layout. A switch lasts until the desktop restarts. The shell option `keymap.hideDefault` hides the item on the first keymap, and the Settings app's Keyboard page edits the list.
  
  The component library adds `ChoiceRow` (`RadioRow`, `CheckboxRow` and `ChoiceList`), the screenshot picker's rows as a component, and `ChoiceToast` takes a `detail` line.
- cd52ce3: The launcher's "Open with…" now lists first the app Enter opens the file with, so the two always agree. `domicile open --which <file|url>` prints the app `domicile open` would run, and the desktop puts its own `domicile` first on its apps' `PATH`.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- b1041f8: The last package-specific scripts leave `scripts/`: `dev-shell` becomes a package the shells' `start:dev` runs, docs media capture moves into the site, `update-engine-release.sh` and the IDL check into the engine, and `smoke-compositor.sh` into the e2e harness.
- ca86667: A shell can add a monitor with no connector, which the desk extends onto and only a capture shows, with `system(domicile).addVirtualMonitor()`. Casting to a TV extends the desk this way.
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

## 0.0.1

### Patch Changes

- Updated dependencies [2056529]
  - @domicile-desktop/sdk@1.0.0
