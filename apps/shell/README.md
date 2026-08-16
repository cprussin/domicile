# @domicile/shell

The bundled reference chrome: a top bar, a clock, and a stage that mounts app
portals. It is the app Domicile ships to prove the model end to end — every
pixel of it is ordinary web content, and each Wayland client on the stage is a
real `<domicile-app>` element that takes ordinary CSS.

## Layout

| Path | What |
|---|---|
| `src/renderer.ts` | Renderer entry: builds the `BridgeClient`, registers the SDK's custom elements, starts the controller. |
| `src/shell-controller.ts` | Mounts/unmounts app portals in response to host events; owns the keybindings. |
| `src/clock.ts` | The top bar's live clock. |
| `src/main.ts` | Electron main process: owns the Unix socket to the compositor and bridges it to the renderer. |
| `src/preload.ts` | Exposes that bridge to the page as `window.domicileTransport`. |
| `src/newline-frames.ts` | Newline-delimited JSON framing for the socket. |
| `src/ipc-channels.ts` | The channel names main and preload agree on. |
| `src/style.css` | The chrome's appearance, including the app-portal styling. |

Electron is the prototype's host: it renders the chrome as a visible, testable
window today. The eventual target embeds CEF directly, at which point `main.ts`
and `preload.ts` are replaced by the engine integration and everything under
`src/` that is not Electron-specific carries over unchanged.

## Keybindings

- **Alt+Enter** — ask the compositor to spawn a terminal (`kitty`) onto
  Domicile.
- **Alt+Shift+Enter** — open a `<domicile-webview>` on the stage.

## Build & run

```sh
bun run turbo build:vite --filter @domicile/shell
```

emits the Electron main bundle to `.vite/build/main.js`, the preload to
`.vite/build/preload.cjs`, and the chrome to
`.vite/renderer/main_window/`. `package.json`'s `main` points at the built
bundle, so with a compositor running:

```sh
electron apps/shell
```

opens the chrome against it. `./scripts/run-prototype.sh` does the whole dance
(compositor + chrome) from the repo root.

`bun run --filter @domicile/shell start:dev` serves the renderer alone on
Vite's dev server, for styling work without a compositor: `renderer.ts` falls
back to a no-op transport when the host injects none.

## Test

```sh
bun run --filter @domicile/shell test
```

runs the type check, the unit tests, and the Vite build. The controller's tests
render against happy-dom via [`@domicile/test-support`](../../packages/test-support/README.md).
