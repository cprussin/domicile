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

## Packages

`@domicile-desktop/manganese` composes these into a desktop. Use them to build
your own.

| Package | Holds |
|---|---|
| [`manganese-host`](../manganese-host/README.md) | The desktop as React context, one value per desktop, shared watches |
| [`manganese-bar`](../manganese-bar/README.md) | The top bar and the context its items read |
| `manganese-bar-module-*` | One bar item each: `launcher-button`, `tray`, `workspace-switcher`, `clock`, `mode`, `theme-switch`, `brightness`, `volume`, `bluetooth`, `network`, `battery`, `notifications`, `sharing`, and `gmail`, which no default bar has |
| [`manganese-window-management`](../manganese-window-management/README.md) | Tiling, floating, workspaces, keybindings and commands, window chrome |
| [`manganese-launcher`](../manganese-launcher/README.md) | The launcher |
| [`manganese-notifications`](../manganese-notifications/README.md) | Toasts and the drawer |
| [`manganese-clipboard`](../manganese-clipboard/README.md) | Clipboard history |
| [`manganese-lock`](../manganese-lock/README.md) | The lock screen |
| [`manganese-wallpaper`](../manganese-wallpaper/README.md) | The wallpaper |
| [`manganese-address`](../manganese-address/README.md) | Typed text as a web address or a search |
| [`manganese-page-requests`](../manganese-page-requests/README.md) | A page's permission, device and dialog prompts |

## Configure

A config module exports `Shell = runManganese(options)` (see
[WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md)). Every option is optional:

- **`applications`**: `omit`, desktop file IDs the launcher hides, and
  `bookmarks`, pages it opens by name. See
  [LAUNCHER.md](/docs/LAUNCHER.md).
- **`bar`**: the bar's `left`, `center` and `right` columns. Defaults to
  `DEFAULT_BAR`. See [TOP-BAR.md](docs/TOP-BAR.md).
- **`floating`**: rules for client windows that open floating, such as
  `[{ app: "pinentry" }, { app: "^Slack$", title: "^Huddle" }]`. See
  [WINDOW-MANAGEMENT.md](../manganese-window-management/docs/WINDOW-MANAGEMENT.md#opening-floating).
- **`keybindings`**: the key table. Defaults to `DEFAULT_KEYBINDINGS` and
  `DEFAULT_MODES` from
  `@domicile-desktop/manganese-window-management/keyboard/commands`, sway's
  keys on Meta. See [KEYS.md](../manganese-window-management/docs/KEYS.md).

It also exports `DEFAULT_BAR`, and `Shell`, which is `runManganese()` and is
what `"shell": "@domicile-desktop/manganese"` loads. Bar items and the
commands bindings use (`focus`, `workspace`, `mode`, …) come from their own
packages.

## More

- [The top bar](docs/TOP-BAR.md): its items and the default layout.
- [Custom bar items](docs/CUSTOM-BAR-ITEMS.md): styling your own bar items.
- [Host readouts](docs/HOST-READOUTS.md): how the backlight and audio are
  read.
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
