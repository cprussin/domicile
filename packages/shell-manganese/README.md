# @domicile-desktop/manganese

Domicile's reference shell: a tiling desktop with [sway](https://swaywm.org)'s
layout and keys, under a transparent top bar.

- The chrome is a React app built from
  [`@domicile-desktop/component-library`](../component-library/README.md) and
  styled with Panda CSS from the library's preset.
- Each Wayland client is an `<app>` element. Each browser window is a
  `<webview>` under an address bar. Both tile, float and close with the same
  keys.
- One page spans every monitor. The bar is drawn once per screen; the windows
  are drawn once for the whole desktop. See
  [ONE-PAGE-FOR-THE-DESK.md](../../docs/architecture/ONE-PAGE-FOR-THE-DESK.md).

## Configure

A config module exports `Shell = runManganese(options)` (see
[WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md)). Both options are optional:

- **`keybindings`**: the key table. Defaults to `DEFAULT_KEYBINDINGS` and
  `DEFAULT_MODES`, sway's keys on Meta.
- **`topBar`**: the bar's `left`, `middle` and `right` columns. Defaults to
  `DEFAULT_TOP_BAR`.

## More

- [Window management](docs/WINDOW-MANAGEMENT.md): workspaces, screens, focus,
  floating, dragging, title bars and animations.
- [Keys](docs/KEYS.md): default bindings, commands, and the differences from
  sway.
- [The top bar](docs/TOP-BAR.md): workspaces, clock, battery, brightness,
  volume, notifications and tray.
- [The launcher](docs/LAUNCHER.md), [the clipboard](docs/CLIPBOARD.md) and
  [the wallpaper](docs/WALLPAPER.md).
- [Host readouts](docs/HOST-READOUTS.md): how the compositor reads the
  backlight and audio.
- [Custom bar items](docs/CUSTOM-BAR-ITEMS.md): styling your own bar items.
- [Focus internals](docs/FOCUS-INTERNALS.md).
- [Source layout](docs/SOURCE.md).

## Build and run

- `bun run turbo build:vite --filter @domicile-desktop/manganese` builds the
  chrome to `.vite/renderer/main_window/`.
- `nix run 'github:cprussin/domicile/stable#manganese'` runs it.
  `./scripts/dev-shell.sh manganese` does the same from a checkout.
- `bun run --filter @domicile-desktop/manganese start:dev` runs it on the
  pinned engine and a compositor built from the checkout, and rebuilds on
  edit. To load the rebuilt shell, run
  `domicile load-shell .vite/renderer/main_window/shell.js` in a terminal on
  that desktop.
- `styled-system/` is Panda's generated output. `bun run prepare` makes it,
  and turbo runs that before build, type check and tests. It is not checked
  in.

## Test

```sh
bun run turbo test --filter @domicile-desktop/manganese
```

Runs the type check, the unit tests and the Vite build. Components render
against happy-dom via [`@domicile-desktop/test-support`](../test-support/README.md).
