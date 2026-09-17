# @domicile/shell-simple

A desktop with nothing in it but windows. Every Wayland client the
host announces gets an `<app>` element on the page; hold **Alt** and
drag one to move it, hold Alt and drag with the **right button** to resize it,
and either way it comes to the front. **Alt+Enter** opens a terminal. That is
the whole user interface — no tabs, no panel, no title bars — and an empty
desktop writes it on its own background, because a shell with nothing to click
has nowhere else to say what it answers to. It is there whenever the desktop
is empty: gone while a window is open, back when the last one leaves.

It is [TinyWM](http://incise.org/tinywm.html) for Domicile, and for TinyWM's
reason: a window manager with no widgets in it shows what a shell is *made of*
without a design on top of it. It is also the worked example of the *simplest
usable React shell* — one component, one stylesheet of plain CSS, and no
dependency on `@domicile/component-library` or Panda. Two neighbors mark the
ends it sits between:

- [`examples/minimal-shell`](/examples/minimal-shell) is the floor — every
  window full-screen, newest on top, no React and no CSS at all. It is also the
  only shell here built against the *published* SDK from outside the workspace,
  which is what makes it the worked example in
  [/docs/WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md).
- [`@domicile/shell-manganese`](../shell-manganese/README.md) is the reference
  chrome, and shows what the model is *for*.

## Layout

| Path | What |
|---|---|
| `src/Shell.tsx` | The whole desktop: the windows, the Alt gestures, the terminal shortcut, and the legend on an empty screen. All of the shell's state is the window list in here. |
| `src/index.tsx` | The entry: build the `DomicileClient`, bind the SDK, mount the React root, report the density and the desktop size. |
| `src/shell.css` | Plain CSS — where a window sits, the placeholder over one with nothing behind it yet, and the legend. |
| `vite.config.ts` | The module build, and the plugin that folds the stylesheet back into it. |

## What it deliberately does not do

- **No chrome.** Nothing is drawn that a pointer can reach, and nothing at all
  once there are windows: the legend naming the keys takes no event and is
  rendered only on an empty desktop, and the one thing drawn over a window is
  its own placeholder label, until it has a surface.
- **No keyboard of its own beyond Alt+Enter.** Every other key goes to the
  window that has the keyboard: the one that opened most recently, or one
  clicked since. One combination is the minimum: a desktop with no way to start
  a terminal is a demo, not a desktop.
- **No window list, no stacking policy beyond raise-on-Alt-press, no close
  button.** A window leaves when its client does.
- **No `<webview>`.** The engine's embedded-browser element is what a
  chrome with an address bar wants; this one has no address bar.

Everything it *does* do is what the model requires of any chrome: place a
portal, forward the pointer and the keyboard, and keep the host told what
density the display is (which changes when the window moves to another screen,
or the page is zoomed).

## Run it

Nothing to clone and nothing to install but Nix — it fetches the repo itself:

```sh
nix run github:cprussin/domicile#simple
```

That starts the engine on this shell's page with the compositor underneath, and
puts the desktop in a window on your display. Which desktop you get is which app
you run — `#manganese` is the reference chrome
([`@domicile/shell-manganese`](../shell-manganese/README.md)) — and a bare
`nix run github:cprussin/domicile` is Domicile itself, which wants a shell of
your own to point at.

The desktop comes up empty but for the keys it answers to. **Alt+Enter** opens
a terminal; the next section covers that and the ways in from outside.

## Launch an app into it

**Alt+Enter** opens a terminal (`kitty`), and everything you start from that
terminal lands here too, inheriting its environment. That is the short answer.

The long one, for launching from outside: Domicile is a Wayland compositor, so
an app joins the desktop by connecting to its display rather than your
session's.

```sh
nix shell nixpkgs#weston -c \
  env XDG_RUNTIME_DIR=<as printed> WAYLAND_DISPLAY=<as printed> weston-flower
```

`XDG_RUNTIME_DIR` and `WAYLAND_DISPLAY` are the whole mechanism — set those two
in front of any Wayland client and it joins the desktop. The `nix shell` prefix
only puts `weston-flower` on `PATH`.

- Both values are printed on startup (`apps on WAYLAND_DISPLAY=…, under
  XDG_RUNTIME_DIR=…`) rather than fixed here. Domicile presents into a window,
  which makes it a client of your session too, so it keeps your runtime dir to
  find that session rather than taking one of its own.
- Never `wayland-0`: the first socket is deliberately skipped, so a client that
  ignores `WAYLAND_DISPLAY` cannot land here by accident. The compositor logs
  the display it actually bound, which is the line above.
- Inside `nix develop .#full`, `weston-flower` and `kitty` are already on `PATH`.
- **No XWayland.** An X11-only client will not connect — it falls back to your
  own session's display, which looks like Domicile ignoring it.

Each window a client maps becomes one `<app>`, so a client that maps
two gets two. New windows cascade rather than stack. A window leaves when its
client exits; there is no close button, so quit apps from inside them.

## Build & run from a checkout

```sh
nix develop .#full -c ./scripts/dev-shell.sh simple
```

does the same thing against your working tree, on the engine the flake pins.
`DOMICILE_ENGINE=<chromium/src>/out/Domicile` runs it on one you built instead
— see [`packages/domicile-engine`](../domicile-engine/README.md) for how that
tree is built. To build the shell alone:

```sh
bun run turbo build:vite --filter @domicile/shell-simple
```

emits the page to `.vite/renderer/main_window/`, and that is the whole of what
a shell builds — there is no main process, no preload and no launcher. A shell
is a built web page: the engine serves it over `domicile://` and loads it, and
the compositor is a producer to that engine. The stylesheet travels *inside*
`shell.js`, because the document Domicile writes carries no `<link>` — see the
plugin in `vite.config.ts`.

`bun run --filter @domicile/shell-simple start:dev` runs this shell in a real
desktop and rebuilds it as you edit — the engine the flake pins and the
compositor out of this checkout. A rebuilt shell needs the desktop restarted —
nothing reloads the page for you until `domicile load-shell` lands, see
`scripts/dev-shell.sh`.

## Test

```sh
bun run turbo test --filter @domicile/shell-simple
```

runs the type check, the unit tests, and the Vite build. `Shell.test.tsx`
renders the component against happy-dom via
[`@domicile/test-support`](../test-support/README.md) and drives it with a fake
domicile client, so every behavior here is exercised through the same messages
and events the host and the pointer deliver.
