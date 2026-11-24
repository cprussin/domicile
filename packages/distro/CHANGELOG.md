# @domicile-desktop/distro

## 0.2.0

### Minor Changes

- 52e71af: Private windows are a private browser profile's: its extension switches say what runs there. The config's `extensions.settings.<id>.private` is gone, and a config that sets it is refused; so are the SDK's `inPrivate` on installed extensions and in `configureExtension()`, and the Settings app's and tray's "Allow in private windows". The tray now shows the extensions of the last focused page's browser profile ("Extensions in Work"): its icons are those switched on there, and its switches switch them in that profile, locked where the config sets them.
- 09be8b7: Text fields in pages, web apps and Electron apps check spelling, in American English unless the config's `spellcheck.languages` says otherwise. The dictionaries ship with the engine and are never downloaded. A context menu event over a misspelled word carries `misspelledWord`, `spellingSuggestions` and `replaceMisspelling()`, and runs `add-to-dictionary`; manganese puts the suggestions at the top of the field's menu.
- 5ba3eae: - NixOS: the system build fails, saying how to fix it, when Domicile cannot load the system's graphics driver (a driver from a newer nixpkgs). Fix: `inputs.domicile.inputs.nixpkgs.follows = "nixpkgs";`.
  - The compositor reports a failed EGL renderer as an error, with an urgent "Graphics aren't working" notification; each render node libgbm refuses is logged with its reason.

### Patch Changes

- 7df5d66: Electron apps' clipboard and link handlers work without `wl-clipboard` or `xdg-utils` installed: Nix puts both on `electron-host`'s `PATH`, and distribution packages recommend them.
- 0f25a37: `domicile-miracast` runs as the user unit `domicile-miracast.service`, part of `graphical-session.target`, so it ends with the desk.

## 0.1.0

### Minor Changes

- af7415e: Hide the pointer while typing and after a pause in pointer input, with `theme.cursor_hide_when_typing` and `theme.cursor_hide_after_ms`. The next pointer move, click, scroll or touchpad gesture shows it again.

## 0.0.2

### Patch Changes

- 13107cb: The tests of the distribution packages and the flake move from `scripts/` into the `distro` package, as `test:shell`, `test:nix` and `test:distro`.
- da62acc: `distro/` and `distro-checks` merge into `packages/distro`. Files every distribution installs (session, launchers, portal, systemd targets, D-Bus service) move from `nix/` to `share/`; `nix/` keeps only the Nix modules.
- 2bf4b18: A desktop whose machine lacks the lock's PAM service, such as a `nix run` trial, does not lock: locked, nothing could unlock it. An urgent notification, "This screen won't lock", says so at startup, and the log names the file to add. Adding it turns the lock on with no restart. The Manganese page notes this under its trial command.
