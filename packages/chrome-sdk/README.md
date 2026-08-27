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

- **`BridgeClient`** (`./bridge`) — the client for the host protocol: version
  handshake, a handler table for host events, and a typed sender per
  chrome→host message. It takes a `Transport` (`send` / `onMessage`), which the
  host injects into the page. A message may carry the moment its bytes reached
  the process, and `bridge.hop` is what that costs to get from there to here.
- **`hostTransport`** (`./host-transport`) — a `Transport` over a byte stream
  carrying the host protocol, for a host that has one to hand: it frames what
  the page sends, reassembles what arrives, stamps each message with when its
  chunk landed, and holds what arrives before the page is listening.
- **Custom elements** (`./register-elements`) — `<domicile-app>` and
  `<domicile-webview>`. An `<domicile-app>` reports its on-screen box to the
  host, forwards pointer and keyboard input to the client underneath it, and
  draws the frames the host pushes back; `focusApp` routes the keyboard to it
  without a click, for a chrome that shows a window the user did not click.
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
  `domicile-scene::Transform`, `./chrome-message` builders for the wire format,
  `./protocol` schemas for decoding host frames, `./input` keycode mapping,
  `./newline-frames` for the delimiter on chrome→host messages, and
  `./host-stream` for reading the host's direction, where an `app_frame`'s
  pixels follow its header as raw bytes.

## Usage

```ts
import {
  BridgeClient,
  describeHandshakeFailure,
} from "@domicile/chrome-sdk/bridge";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

const bridge = new BridgeClient(window.domicileTransport);
registerElements(bridge);
(await bridge.connect()).match({
  Err: (failure) => {
    console.error(describeHandshakeFailure(failure));
  },
  Ok: () => {
    // The host ignores everything sent before the handshake.
  },
});
```

`connect` reports a failed handshake rather than rejecting: the two halves
speaking different protocol versions is part of what the call answers, not a
bug in it. `Result` has no `unwrap`, so the caller has to say what happens on
each arm.

Then render `<domicile-app app-id="…">` / `<domicile-webview src="…">` as
normal DOM and style them with ordinary CSS — rounding, blur, transforms, and
z-index all apply to the live client surface. That is the whole point of
Domicile.

Custom element tag names must contain a hyphen, so the SDK registers
`domicile-app` and `domicile-webview`. The engine integration layer aliases the
bare `<app>` / `<webview>` names the compositor exposes.

### Putting a window between two layers of chrome

By default the chrome is one texture drawn over every window, so a window can
never be in front of any part of it. Where the page can resolve that itself it
already does — an `<domicile-app>` element paints nothing, so a panel above a
window arrives as chrome pixels over transparent and blends correctly.

Where it cannot, `render-bands` is the answer: the shell names the depths it
draws at, and the compositor asks for one at a time and draws each between the
windows it belongs between.

```ts
import { renderBands } from "@domicile/chrome-sdk/render-bands";

const stop = renderBands(bridge, [0, 10], (band) => {
  // Leave *only* this band painting. What the page commits next is the raster
  // the compositor draws at that depth.
  wallpaper.hidden = band !== 0;
  panels.hidden = band !== 1;
});
```

**What declaring bands obliges a shell to do:** commit nothing else while a
band is outstanding. The compositor takes the page's next commit as the band it
asked for — the page cannot label its own frames, because the Wayland
connection belongs to Chromium rather than to the page — so a repaint of the
chrome's own is a commit it cannot tell from the answer, and taking it as one
files every later band under the wrong depth. `renderBands` causes no repaint
of its own; a CSS animation or a video in the shell still would.

A shell that never calls this declares nothing and is drawn as one layer over
every window, which is what every chrome did before bands existed.

### Knowing which modifiers are held

`wl_keyboard.modifiers` goes to whatever holds the keyboard, so the moment a
window is focused the page stops hearing about the Alt the user is holding —
which is exactly when a shell wants to know, because that is when it would
begin an alt-drag. The host says instead:

```ts
bridge.on("modifiers", ({ alt }) => {
  // While Alt is held, let the pointer reach the page rather than the window
  // it is over: `pointer-events: none` is what tells the compositor the
  // window is not taking clicks, and it hit-tests accordingly.
  portal.style.pointerEvents = alt ? "none" : "";
});
```

Sent when the set changes, so a modifier held down arrives once and letting go
arrives once; an ordinary key never appears here at all.

Unlike `grabShortcut` this claims nothing — the focused window is given the
key as well, because a modifier the chrome had to take would be one no window
could ever use.

## Dependencies

`zod`, used only at the host boundary: incoming frames are parsed against the
schemas in `./protocol` rather than cast, so a malformed frame fails loudly
where it enters. An unknown *message type* is not malformed — it is dropped, so
a newer host can add messages an older chrome ignores.

`@cprussin/option-result`, for the one outcome a caller has to decide about
rather than recover from: `connect` returns `Result<number, HandshakeFailure>`.
Everything else here either throws — a bug, per
[ERRORS.md](/docs/guidelines/ERRORS.md) — or returns `T | undefined` for
ordinary absence.

## Test

```sh
bun run --filter @domicile/chrome-sdk test
```

DOM-dependent suites run against happy-dom via
[`@domicile/test-support`](../test-support/README.md). That DOM performs no
layout, so element tests inject a `measure` stub through
`registerElements(bridge, { measure })` rather than relying on
`getBoundingClientRect`.
