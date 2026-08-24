# @domicile/shell-simple

The smallest Domicile chrome that is still a desktop. Every Wayland client the
host announces gets a `<domicile-app>` element on the page; hold **Alt** and
drag one to move it, hold Alt and drag with the **right button** to resize it,
and either way it comes to the front. **Alt+Enter** opens a terminal. That is
the whole user interface — no tabs, no panel, no title bars.

It is [TinyWM](http://incise.org/tinywm.html) for Domicile, and for TinyWM's
reason: a window manager with no widgets in it is the shortest honest answer to
"what does a shell actually have to do?". The answer here is about ninety lines
of it — [`@domicile/shell-manganese`](../shell-manganese/README.md) is the
reference chrome that shows what the model is *for*.

## Layout

| Path | What |
|---|---|
| `src/renderer.ts` | Renderer entry, and the whole of the wiring: build the `BridgeClient`, register the SDK's elements, open a window per client, install the gestures and the shortcut. |
| `src/desktop.ts` | The windows on screen: one `<domicile-app>` per client, each at a box this module owns. All of the shell's state. |
| `src/window-gestures.ts` | Alt and the pointer: what a press, a drag and a release do to the window under them. |
| `src/terminal-shortcut.ts` | Alt+Enter: the one combination this shell claims, and the terminal it opens. |
| `src/drag.ts` | Where a dragged window lands, as arithmetic — no DOM, so it is testable on its own. |
| `src/window-box.ts` | A window's box, and where a newly-appeared client's window opens. |
| `src/main.ts` | Electron main process: opens the window and loads the page into it, and exits with a reason on the renderer's behalf. Wires nothing else onto it — that is the difference from manganese's. |
| `src/preload.ts` | Opens the compositor connection and exposes it to the page as `window.domicileHost`. Everything with a decision in it — where the socket is, what its death means — is [`@domicile/electron-chrome-host`](../electron-chrome-host/README.md). |
| `src/domicile-elements.d.ts` | `<domicile-app>` in the DOM's tag-name map, so `createElement` returns the SDK's class. |

## What it deliberately does not do

- **No chrome.** Nothing is drawn that is not a client's window. A window that
  has no surface yet shows a placeholder label, and that is the only thing this
  shell paints.
- **No keyboard of its own beyond Alt+Enter.** The SDK routes every other key
  to whichever window was last clicked. One combination is the minimum: a
  desktop with no way to start a terminal is a demo, not a desktop.
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

The desktop comes up empty. **Alt+Enter** opens a terminal; the next section
covers that and the ways in from outside.

## Launch an app into it

**Alt+Enter** opens a terminal (`kitty`), and everything you start from that
terminal lands here too, inheriting its environment. That is the short answer.

The long one, for launching from outside: Domicile is a Wayland compositor, so
an app joins the desktop by connecting to its display rather than your
session's.
Two environment variables are the whole mechanism.

```sh
XDG_RUNTIME_DIR=/tmp/domicile-rt WAYLAND_DISPLAY=wayland-1 <any wayland app>
```

```sh
# from outside the dev shell
nix shell nixpkgs#weston -c \
  env XDG_RUNTIME_DIR=/tmp/domicile-rt WAYLAND_DISPLAY=wayland-1 weston-flower
```

- `/tmp/domicile-rt` is Domicile's own runtime dir, kept separate so its display
  does not clash with your real desktop's.
- `wayland-1`, not `wayland-0`: the first socket is deliberately skipped, so a
  client that ignores `WAYLAND_DISPLAY` cannot land here by accident. The
  compositor logs the display it actually bound.
- Inside `nix develop .#full`, `weston-flower` and `kitty` are already on `PATH`.
- **No XWayland.** An X11-only client will not connect — it falls back to your
  own session's display, which looks like Domicile ignoring it.

Each window a client maps becomes one `<domicile-app>`, so a client that maps
two gets two. New windows cascade rather than stack. A window leaves when its
client exits; there is no close button, so quit apps from inside them.

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
