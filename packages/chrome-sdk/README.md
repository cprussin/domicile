# @domicile/chrome-sdk

> Published to npm, and usable outside this repo. If you are writing a shell,
> start with [/docs/WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md) — this is the
> reference for the package, that is the guide to using it.
>
> It ships built JavaScript and `.d.ts` from `dist/`, not the TypeScript in
> `src/`: run `bun run build` before anything outside the workspace resolves it.

The in-page half of Domicile. A Domicile chrome is ordinary web content; this
package is what lets that content talk to the compositor and mount real Wayland
clients as DOM elements.

It provides four things:

- **`DomicileClient`** (`./domicile-client`) — the client for `navigator.domicile`, the
  typed control channel the forked engine puts on a document it served. It
  takes a `DomicileHost` and gives back a handler table for what the compositor
  says and a typed call per thing the chrome asks of it. There is no handshake
  and no wire: what it adds over the host itself is that it **registers its own
  listeners in its constructor and holds what arrives before your `on` does** —
  a DOM event dispatched with no listener is gone, and a React shell registers
  tens of milliseconds after the compositor has announced every window already
  running. For the same reason a page must never call `addEventListener` on
  `navigator.domicile` itself.
- **Custom elements** (`./register-elements`) — `<domicile-app>` and
  `<domicile-webview>`. An `<domicile-app>` reports its on-screen box to the
  host, embeds that client's surface, and forwards pointer and keyboard input
  to it; `focusApp` routes the keyboard to it without a click, for a chrome
  that shows a window the user did not click. A click on one fires a
  cancellable `domicile-focus-requested` and then focuses the client, so a
  shell that wants focus to be its own decision calls `preventDefault()` and a
  shell with no opinion needs to know nothing about it.
  A `<domicile-webview>` embeds a nested browsing context the engine renders
  directly: its `src` is the address on screen (it follows the page wherever the
  content navigates, and fires `domicile-navigate` when it lands), `goBack` /
  `goForward` / `stop` / `reload` are what a chrome's address bar drives it
  with, and `focus` puts the keyboard on the embedded page.
- **`reportDevicePixelRatio`** (`./device-pixel-ratio`) — tell the host what
  density the page is drawing at, and keep telling it. The ratio changes when
  the window moves to another display or the page is zoomed, and the page is
  the only part of Domicile that can see either; a chrome that reported it once
  would leave every client drawing at the old resolution.
- **Pure helpers** — affine `./matrix` math mirroring the Rust
  `domicile-scene::Transform`, `./domicile-host` mirroring the engine's IDL,
  `./host-message` for what the client delivers and how an event becomes one,
  `./cursor-shape` for the keyword set a client can ask for, and `./input`
  keycode mapping. `./protocol`, `./chrome-message`, `./newline-frames` and
  `./host-stream` are the compositor's own JSON wire, which **a page no longer
  speaks**: they are there for `@domicile/e2e-harness`, a headless stand-in for
  a chrome that talks to the compositor's socket directly.

## Usage

```ts
import { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { connectToHost } from "@domicile/chrome-sdk/connect-to-host";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

const domicile = new DomicileClient(connectToHost(navigator));
registerElements(domicile);
```

That is the whole of it. There is nothing to await: `connect()` is gone with
the handshake it performed, the compositor's protocol version is checked in the
browser process and only logged, and the first call on the channel is what
binds it. Say what you have to say as soon as you have a domicile.

Opened in an ordinary browser there is no `navigator.domicile` at all —
`vite dev` on a shell's page is a real thing to do — and `connectToHost` hands
back a stand-in that does nothing and says so once on the console. Ask
`hasHost(navigator)` if your own code needs the answer.

Then render `<domicile-app app-id="…">` / `<domicile-webview src="…">` as
normal DOM and style them with ordinary CSS — rounding, blur, transforms, and
z-index all apply to the live client surface. That is the whole point of
Domicile.

Custom element tag names must contain a hyphen, so the SDK registers
`domicile-app` and `domicile-webview`. The engine integration layer aliases the
bare `<app>` / `<webview>` names the compositor exposes.

### Knowing which modifiers are held

`wl_keyboard.modifiers` goes to whatever holds the keyboard, so the moment a
window is focused the page stops hearing about the Alt the user is holding —
which is exactly when a shell wants to know, because that is when it would
begin an alt-drag. The host says instead:

```ts
domicile.on("modifiers", ({ altKey }) => {
  // While Alt is held, let the pointer reach the page rather than the window
  // it is over: `pointer-events: none` is what tells the compositor the
  // window is not taking clicks, and it hit-tests accordingly.
  portal.style.pointerEvents = altKey ? "none" : "";
});
```

Sent when the set changes, so a modifier held down arrives once and letting go
arrives once; an ordinary key never appears here at all.

Unlike `grabShortcut` this claims nothing — the focused window is given the
key as well, because a modifier the chrome had to take would be one no window
could ever use.

## Dependencies

`zod`, in two places and both of them boundaries. `./protocol` parses the
compositor's JSON for the headless harness rather than casting it. And
`./cursor-shape` parses one field off the typed channel — `DomicileAppEvent`
declares `cursor` as a `DOMString` rather than a WebIDL enum, so it is the last
value here that the engine does not check, and an unknown keyword assigned to
`style.cursor` fails silently.

Nothing else. `@cprussin/option-result` was a dependency for exactly one
outcome — `connect()` returning `Result<number, HandshakeFailure>` — and there
is no handshake to fail. Everything here either throws (a bug, per
[ERRORS.md](/docs/guidelines/ERRORS.md)) or returns `T | undefined` for
ordinary absence.

## Test

```sh
bun run --filter @domicile/chrome-sdk test
```

DOM-dependent suites run against happy-dom via
[`@domicile/test-support`](../test-support/README.md). That DOM performs no
layout, so element tests inject a `measure` stub through
`registerElements(domicile, { measure })` rather than relying on
`getBoundingClientRect`.
