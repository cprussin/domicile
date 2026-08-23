# @domicile/shell-simple

The smallest Domicile chrome that is still a desktop. Every Wayland client the
host announces gets a `<domicile-app>` element on the page; hold **Alt** and
drag one to move it, hold Alt and drag with the **right button** to resize it,
and either way it comes to the front. That is the whole user interface — no
tabs, no panel, no launcher, no title bars.

It is [TinyWM](http://incise.org/tinywm.html) for Domicile, and for TinyWM's
reason: a window manager with no widgets in it is the shortest honest answer to
"what does a shell actually have to do?". The answer here is about ninety lines
of it — [`@domicile/shell-manganese`](../shell-manganese/README.md) is the
reference chrome that shows what the model is *for*.

## Layout

| Path | What |
|---|---|
| `src/renderer.ts` | Renderer entry, and the whole of the wiring: build the `BridgeClient`, register the SDK's elements, open a window per client, install the gestures. |
| `src/desktop.ts` | The windows on screen: one `<domicile-app>` per client, each at a box this module owns. All of the shell's state. |
| `src/window-gestures.ts` | Alt and the pointer: what a press, a drag and a release do to the window under them. |
| `src/drag.ts` | Where a dragged window lands, as arithmetic — no DOM, so it is testable on its own. |
| `src/window-box.ts` | A window's box, and where a newly-appeared client's window opens. |
| `src/main.ts` | Electron main process: opens the window and loads the page into it, and exits with a reason on the renderer's behalf. Wires nothing else onto it — that is the difference from manganese's. |
| `src/preload.ts` | Opens the compositor connection and exposes it to the page as `window.domicileHost`. Everything with a decision in it — where the socket is, what its death means — is [`@domicile/electron-chrome-host`](../electron-chrome-host/README.md). |
| `src/domicile-elements.d.ts` | `<domicile-app>` in the DOM's tag-name map, so `createElement` returns the SDK's class. |

## What it deliberately does not do

- **No chrome.** Nothing is drawn that is not a client's window. A window that
  has no surface yet shows a placeholder label, and that is the only thing this
  shell paints.
- **No keyboard of its own.** The SDK routes the keyboard to whichever window
  was last clicked; this shell claims no combination, so there is nothing to
  launch an app *from*. Start clients from a terminal already on the desktop,
  or from the compositor's own runner.
- **No window list, no stacking policy beyond raise-on-Alt-press, no close
  button.** A window leaves when its client does.
- **No `<domicile-webview>`.** The SDK's embedded-browser element is what a
  chrome with an address bar wants; this one has no address bar.

Everything it *does* do is what the model requires of any chrome: place a
portal, draw the frames the host pushes, forward the pointer and the keyboard,
and keep the host told what density the display is (which changes when the
window moves to another screen, or the page is zoomed).

## Run it

Nothing to clone and nothing to install but Nix — it fetches the repo itself:

```sh
nix run github:cprussin/domicile#prototype -- simple
```

That builds Domicile's headless Wayland compositor and this shell, starts both,
and puts the desktop on your display. The `-- simple` names the directory under
`packages/shell-*`; without it you get the reference chrome
([`@domicile/shell-manganese`](../shell-manganese/README.md)) instead.

Nix hands the app the source read-only in the store while the build writes into
the tree, so it first stages the fetched source under
`~/.cache/domicile/<revision>` — set `DOMICILE_RUN_DIR` to put it elsewhere —
and builds there. Re-running the same revision reuses those artifacts.

The desktop comes up empty, and stays that way until you put something on it —
this shell has no launcher of its own, which is the next section.

## Launch an app into it

Domicile is a Wayland compositor, so an app joins the desktop the ordinary way:
by connecting to its display instead of your session's. Two environment
variables are the whole of it.

```sh
XDG_RUNTIME_DIR=/tmp/domicile-rt WAYLAND_DISPLAY=wayland-1 <any wayland app>
```

The runtime dir is Domicile's own — kept separate so its display does not clash
with the one your real desktop is already using — and `wayland-1` is the
display inside it. (Not `wayland-0`: the first socket is deliberately skipped,
so a client that ignores `WAYLAND_DISPLAY` cannot land here by accident.) The
prototype prints both when it starts, and the compositor logs the display it
actually bound.

**Something instant**, to see a window arrive:

```sh
nix shell nixpkgs#weston -c \
  env XDG_RUNTIME_DIR=/tmp/domicile-rt WAYLAND_DISPLAY=wayland-1 weston-flower
```

**A terminal**, which is the one worth having — anything you start from it
inherits those two variables, so it lands on Domicile too and you never type
them again:

```sh
nix shell nixpkgs#kitty -c \
  env XDG_RUNTIME_DIR=/tmp/domicile-rt WAYLAND_DISPLAY=wayland-1 kitty
```

From a checkout inside `nix develop .#full`, both are already on `PATH` and the
`nix shell` prefix is unnecessary.

Each window a client maps becomes one `<domicile-app>` — a client that maps two
gets two, which the terminal above will do the moment you ask it for a second
OS window. Hold **Alt** and drag one to move it, Alt and the right button to
resize it, and Alt-press it to raise it — that is the entire user interface.
New windows cascade rather than stack on each other. A window leaves when its
client exits, and there is no way to close one from the desktop, so quit apps
from inside them.

The app has to speak Wayland: there is no XWayland here, so an X11-only client
will not connect. Most toolkits do — GTK, Qt, and Electron given
`--ozone-platform=wayland` — and a client that silently opens on your normal
desktop instead has almost always fallen back to the display in your own
environment.

## Build & run from a checkout

```sh
nix develop .#full -c ./scripts/run-prototype.sh simple
```

does the same thing against your working tree. To build the shell alone:

```sh
bun run turbo build:vite --filter @domicile/shell-simple
```

emits the Electron main bundle to `.vite/build/main.js`, the preload to
`.vite/build/preload.cjs`, and the chrome to `.vite/renderer/main_window/`.
`package.json`'s `main` points at the built bundle, so with a compositor
running:

```sh
electron packages/shell-simple
```

opens this desktop against it. `DOMICILE_CHROME_SOCKET` says where the
compositor's chrome socket is (`$XDG_RUNTIME_DIR/domicile-chrome.sock` by
default), and `DOMICILE_COMPOSITED=1` makes the window transparent for the path
where Domicile draws the clients itself rather than sending their pixels here.

`bun run --filter @domicile/shell-simple start:dev` serves the renderer alone on
Vite's dev server: with no host to inject a transport, no window ever appears —
useful only for looking at what the empty desktop is.

`styled-system/` is Panda's generated output, produced by `bun run prepare` (run
automatically as a turbo dependency of the build, type check, and tests) and not
checked in. This shell renders none of the component library's components; it
takes its preset so the desktop is themed like the rest of Domicile.

## Test

```sh
bun run --filter @domicile/shell-simple test
```

runs the type check, the unit tests, and the Vite build. The DOM-dependent
suites render against happy-dom via
[`@domicile/test-support`](../test-support/README.md), which performs no layout
— so they inject the SDK's `measure` rather than relying on
`getBoundingClientRect`.
