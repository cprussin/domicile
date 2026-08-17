# @domicile/chrome-sdk

The in-page half of Domicile. A Domicile chrome is ordinary web content; this
package is what lets that content talk to the compositor and mount real Wayland
clients as DOM elements.

It provides three things:

- **`BridgeClient`** (`./bridge`) — the client for the host protocol: version
  handshake, a handler table for host events, and a typed sender per
  chrome→host message. It takes a `Transport` (`send` / `onMessage`), which the
  host injects into the page.
- **Custom elements** (`./register-elements`) — `<domicile-app>` and
  `<domicile-webview>`. An `<domicile-app>` reports its on-screen box to the
  host, forwards pointer and keyboard input to the client underneath it, and
  draws the frames the host pushes back. A `<domicile-webview>` embeds a nested
  browsing context the engine renders directly: its `src` is the address on
  screen (it follows the page wherever the content navigates, and fires
  `domicile-navigate` when it lands), and `goBack` / `goForward` / `stop` /
  `reload` are what a chrome's address bar drives it with.
- **Pure helpers** — affine `./matrix` math mirroring the Rust
  `domicile-scene::Transform`, `./chrome-message` builders for the wire format,
  `./protocol` schemas for decoding host frames, `./input` keycode mapping, and
  `./frame` base64 → RGBA decoding.

## Usage

```ts
import { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { registerElements } from "@domicile/chrome-sdk/register-elements";

const bridge = new BridgeClient(window.domicileTransport);
registerElements(bridge);
await bridge.connect();
```

Then render `<domicile-app app-id="…">` / `<domicile-webview src="…">` as
normal DOM and style them with ordinary CSS — rounding, blur, transforms, and
z-index all apply to the live client surface. That is the whole point of
Domicile.

Custom element tag names must contain a hyphen, so the SDK registers
`domicile-app` and `domicile-webview`. The engine integration layer aliases the
bare `<app>` / `<webview>` names the compositor exposes.

## Dependencies

`zod`, used only at the host boundary: incoming frames are parsed against the
schemas in `./protocol` rather than cast, so a malformed frame fails loudly
where it enters. An unknown *message type* is not malformed — it is dropped, so
a newer host can add messages an older chrome ignores.

## Test

```sh
bun run --filter @domicile/chrome-sdk test
```

DOM-dependent suites run against happy-dom via
[`@domicile/test-support`](../test-support/README.md). That DOM performs no
layout, so element tests inject a `measure` stub through
`registerElements(bridge, { measure })` rather than relying on
`getBoundingClientRect`.
