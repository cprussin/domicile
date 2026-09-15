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

It provides these:

- **`DomicileClient`** (`./domicile-client`) — the client for `window.domicile`, the
  typed control channel the forked engine puts on a document it served. It
  takes a `DomicileHost` and gives back a handler table for what the compositor
  says and a typed call per thing the chrome asks of it. There is no handshake
  and no wire: what it adds over the host itself is that it **registers its own
  listeners in its constructor and holds what arrives before your `on` does** —
  a DOM event dispatched with no listener is gone, and a React shell registers
  tens of milliseconds after the compositor has announced every window already
  running. For the same reason a page must never call `addEventListener` on
  `window.domicile` itself.
- **`registerElements`** (`./register-elements`) — the input and size routing
  behind the engine's `<app>` tag. It reports each window's on-screen box to the
  host, forwards the pointer over one to the client underneath in that client's
  own surface coordinates, and routes the page's keystrokes to whichever window
  was last reached for. All of it is delegated from `document` over
  `closest("app")`: the tag is the engine's, so there is no element class to hang
  any of it on, and nothing here is registered. A click on a window fires a
  cancelable `domicile-focus-requested` and then focuses the client, and a press
  that lands off every window fires a cancelable
  `domicile-focus-release-requested` on the window that holds the keyboard and
  then hands it back to the page — so a shell that wants focus to be its own
  decision calls `preventDefault()` on either, and a shell with no opinion needs
  to know nothing about them.
- **`<app>`** (`./app-element`) — the tag name, the two focus events, and the
  TypeScript for the element, which is the fork's. The surface embed and the size
  a client is configured at are both the layout box's and the engine reports
  them; there is nothing to call.
- **`focusApp`** (`./focus-app`) — put the keyboard on a client without a click.
  Not the same as `DomicileClient.focusApp`, which asks the compositor and stops:
  keyboard events reach `document` rather than an element, so the SDK has to be
  told too.
- **`<webview>`** (`./webview-element`) — types and event names only. The
  element is the engine's: `src` is the address it loads, `goBack` /
  `goForward` / `stop` / `reload` are what a chrome's address bar drives it
  with, `canGoBack` / `canGoForward` say whether the first two would do
  anything, and `focus` puts the keyboard on the embedded page. What this
  module adds is the TypeScript for all of that plus the names of the two
  events the browser process dispatches on it,
  `domicile-guest-focus` and `domicile-history-change`.
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

const domicile = new DomicileClient(connectToHost(window));
registerElements(domicile);
```

That is the whole of it. There is nothing to await: `connect()` is gone with
the handshake it performed, the compositor's protocol version is checked in the
browser process and only logged, and the first call on the channel is what
binds it. Say what you have to say as soon as you have a domicile.

Opened in an ordinary browser there is no `window.domicile` at all —
`vite dev` on a shell's page is a real thing to do — and `connectToHost` hands
back a stand-in that does nothing and says so once on the console. Ask
`hasHost(window)` if your own code needs the answer.

`navigator.domicile` is the same object and still reads, so `connectToHost`
takes either global and prefers neither. `window.domicile` is the spelling the
guides use.

Then render `<app app-id="…">` / `<webview src="…">` as normal DOM and style
them with ordinary CSS — rounding, blur, transforms, and z-index all apply to the
live client surface. That is the whole point of Domicile.

Both tags are the fork's own HTML elements, so there is nothing to register and
nothing here to wrap them in — a custom element's name must contain a hyphen, per
spec, which is exactly why they are the engine's. Note what that costs in a React
chrome: a tag without a hyphen is an ordinary HTML element to React, so it writes
no unrecognized property and binds no `on…` prop for an event it has not heard
of. Bind the events on a ref.

### Knowing which modifiers are held

**Read them off your own key events.** The desktop is the chrome's window, so
the page hears every key the user presses whatever the compositor's seat is
pointed at — that is how `registerElements` forwards a keystroke to a client in
the first place:

```ts
const follow = (event: KeyboardEvent) => {
  // While Alt is held, let the pointer reach the page rather than the window
  // it is over: `pointer-events: none` is what tells the compositor the
  // window is not taking clicks, and it hit-tests accordingly.
  portal.style.pointerEvents = event.altKey ? "none" : "";
};
document.addEventListener("keydown", follow);
document.addEventListener("keyup", follow);
```

**Not off the host's `modifiers` message, today.** It reports the compositor's
seat, and the seat only knows the keys this page forwarded to it — which is
only the keys pressed while a client held the keyboard. A modifier pressed
while the chrome held it never reaches the seat, and the next forwarded key
makes the message deny it: a shell that believed the message over its own
keystrokes read a held Alt as let go of. The message is still sent, and is what
will say so on the day input comes off DRM rather than out of the browser; it
cannot know more than this page until then.

## Dependencies

`zod`, in two places and both of them boundaries. `./protocol` parses the
compositor's JSON for the headless harness rather than casting it. And
`./cursor-shape` parses one field off the typed channel — not because the
engine fails to check it, since `DomicileAppCursorEvent.cursor` is a WebIDL
`enum` over the same closed set, but because this package and the engine are
published apart. A shape this list has and the running engine does not arrives
as a keyword no `DomicileCursorShape` names, and an unknown keyword assigned to
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
layout, so the routing tests inject a `measure` stub — and a frame source —
through `registerElements(domicile, { measure, observePlacement })` rather than
relying on `getBoundingClientRect` and on however fast happy-dom serves an
animation frame.

happy-dom has never heard of `<app>`, so it creates one as an
`HTMLUnknownElement`, which React's development build reports on the console as
an unrecognized tag. It cannot happen on the fork, where the tag is
`HTMLAppElement`; React exempts `dialog` and `webview` from that report by name
and there is no way to add a third.
