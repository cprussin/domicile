# @domicile-desktop/shell-simple

The simplest usable React shell for Domicile, modeled on
[TinyWM](http://incise.org/tinywm.html).

- Each Wayland client window becomes an `<app>` element. New windows cascade.
  A window closes when its client exits.
- **Alt+drag** moves a window. **Alt+right-drag** resizes it. Either raises it.
- **Alt+Enter** sends the `terminal` command, which opens `kitty`. It matches
  Enter in any keyboard layout. The `keybindings` prop replaces the default
  set (Alt+Enter → `terminal`). Unknown commands are logged to the console and
  ignored.
- Other keys go to the focused window (the newest, or the last one clicked).
- An empty desktop shows these keys on its background.
- No title bars, panels, window list, close button or `<webview>`.
- One component and one plain CSS file. No `component-library` or Panda.

For a smaller shell built against the published SDK, see
[`examples/minimal-shell`](/examples/minimal-shell). For the full reference
shell, see [`@domicile-desktop/manganese`](../shell-manganese/README.md).

## Layout

| Path | What |
|---|---|
| `src/Shell.tsx` | The desktop: windows, Alt gestures, terminal command, background legend. |
| `src/index.tsx` | Entry point. Creates the `DomicileClient`, mounts React, reports density and desktop size. |
| `src/shell.css` | Window placement, the placeholder shown before a surface arrives, the legend. |
| `vite.config.ts` | Module build. Inlines the stylesheet into `shell.js`, since the shell page has no `<link>`. |

## Run it

```sh
nix run github:cprussin/domicile/stable#simple
```

This runs the engine and compositor in a window on your display.

## Launch an app into it

Apps started from the Alt+Enter terminal open on this desktop.

To launch from outside, point a Wayland client at Domicile's display:

```sh
nix shell nixpkgs#weston -c \
  env XDG_RUNTIME_DIR=<as printed> WAYLAND_DISPLAY=<as printed> weston-flower
```

- Domicile prints both values on startup: `apps on WAYLAND_DISPLAY=…, under
  XDG_RUNTIME_DIR=…`.
- The display is never `wayland-0`. Domicile skips it so clients that ignore
  `WAYLAND_DISPLAY` don't connect by accident.
- There is no XWayland. X11-only clients open on your own session instead.

## Build and run from a checkout

```sh
nix develop .#full -c ./scripts/dev-shell.sh simple
```

- `nix develop .#full` puts `weston-flower` and `kitty` on `PATH`.
- Set `DOMICILE_ENGINE=<chromium/src>/out/Domicile` to use a local engine
  build. See [`packages/domicile-engine`](../domicile-engine/README.md).
- `bun run --filter @domicile-desktop/shell-simple start:dev` rebuilds on edit.
- The page doesn't reload. Run
  `domicile load-shell .vite/renderer/main_window/shell.js` in a terminal on
  that desktop.

Build the shell page alone (output in `.vite/renderer/main_window/`):

```sh
bun run turbo build:vite --filter @domicile-desktop/shell-simple
```

## Test

```sh
bun run turbo test --filter @domicile-desktop/shell-simple
```

Runs the type check, unit tests and Vite build. `Shell.test.tsx` renders the
shell in happy-dom with a fake Domicile client, via
[`@domicile-desktop/test-support`](../test-support/README.md).
