# @domicile-desktop/sdk

The SDK a Domicile shell uses to talk to the compositor and embed Wayland
clients as DOM elements.

- Published to npm. To write a shell, start with
  [WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md); this README is the package
  reference.
- Ships built JavaScript and `.d.ts` from `dist/`. Run `bun run build` before
  anything outside the workspace imports it.

## Usage

```ts
import { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import { connectToHost } from "@domicile-desktop/sdk/connect-to-host";
import { registerElements } from "@domicile-desktop/sdk/register-elements";

const domicile = new DomicileClient(connectToHost(window));
registerElements(domicile);
```

- Nothing to await. Call the client as soon as you have it.
- Always go through `DomicileClient`. It listens from construction and buffers
  messages until you call `on`. Listening on `window.domicile` directly misses
  messages sent before your listener exists.
- In an ordinary browser (e.g. `vite dev`) there is no `window.domicile`.
  `connectToHost` returns a no-op host and logs a warning once.
  `hasHost(window)` tells you which case you are in.
- Render `<app app-id="…">` and `<webview src="…">` as normal DOM. CSS
  (rounding, blur, transforms, z-index) applies to the live surface.
- Both tags are the engine's built-in elements. In React, bind their events on
  a ref; React does not bind `on…` props for unknown events.
- Errors follow [ERRORS.md](/docs/guidelines/ERRORS.md): bugs throw, absence
  is `T | undefined`.

See [docs/ELEMENTS.md](docs/ELEMENTS.md) for input routing, focus and the
`<webview>` API.

## Modules

| Module | What it is |
| --- | --- |
| `./domicile-client` | `DomicileClient`: typed calls to the compositor and handlers for its messages. |
| `./connect-to-host` | `connectToHost`, `hasHost`. |
| `./shell` | `Shell`: the export a shell module must provide. Domicile calls it once with the element to draw in. |
| `./register-elements` | Input routing for `<app>`. |
| `./app-element`, `./webview-element` | Types and event names for `<app>` and `<webview>`. |
| `./focus-app`, `./focus-chrome` | Move the keyboard to a client or back to the page. Use these, not the `DomicileClient` methods of the same name. |
| `./bind-keys` | `bindKeys`: claim a shell's own key chords and modes. `./keybindings`, `./key-action` and `./own-keybindings` are its parts. It owns the `shell_config` and `shortcut` handlers. Don't register them yourself. |
| `./extension`, `./tray`, `./notification`, `./audio`, `./theme`, `./file-preview`, `./display-transform` | Data types (and Zod schemas) for what `DomicileClient` delivers. |

Internals, not needed by shells:

- `./matrix`, `./measure`, `./element-transform`, `./surface-coordinates`,
  `./input`, `./cursor-shape`, `./domicile-host`, `./host-message`: pure
  helpers and routing parts.
- `./protocol`, `./chrome-message`, `./newline-frames`, `./host-stream`: the
  compositor's JSON socket protocol, for `@domicile-desktop/e2e-harness`.

## Dependencies

- `zod` only. It parses the compositor's JSON (`./protocol`) and the cursor
  keyword (`./cursor-shape`), which a newer engine may send unknown values for.

## Test

```sh
bun run turbo test --filter @domicile-desktop/sdk
```

- DOM suites run on happy-dom via
  [`@domicile-desktop/test-support`](../test-support/README.md).
- happy-dom does no layout, so routing tests pass a `measure` stub:
  `registerElements(domicile, { measure })`.
- React's dev build logs an unknown-tag warning for `<app>` in tests only.
