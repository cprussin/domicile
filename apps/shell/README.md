# @domicile/shell

The bundled reference chrome: a top bar, a clock, a tab strip, and a stage that
shows one window at a time. It is the app Domicile ships to prove the model end
to end — every pixel of it is ordinary web content, and each Wayland client on
the stage is a real `<domicile-app>` element that takes ordinary CSS.

A window is either a Wayland client the host announced or a browser window the
shell opened itself; both get a tab, and the tab bar is what switches between
them. Only the window on the stage has a box, so the SDK reports the rest to the
host as no longer composited.

## Layout

| Path | What |
|---|---|
| `src/renderer.ts` | Renderer entry: builds the `BridgeClient`, registers the SDK's custom elements, starts the controller, wires the bar's launchers. |
| `src/shell-controller.ts` | Owns the windows: mounts/unmounts them in response to host events, shows one at a time, keeps the tab bar in step; owns the keybindings and launchers. |
| `src/tab-bar.ts` | The strip of tabs for the open windows. |
| `src/browser-window.ts` | A browser window: an address bar (back / forward / stop / reload) over a `<domicile-webview>`. |
| `src/clock.ts` | The top bar's live clock. |
| `src/main.ts` | Electron main process: owns the Unix socket to the compositor and bridges it to the renderer. |
| `src/preload.ts` | Exposes that bridge to the page as `window.domicileTransport`. |
| `src/ipc-channels.ts` | The channel names main and preload agree on. |
| `src/style.css` | The chrome's appearance, including the window styling. |

Electron is the prototype's host: it renders the chrome as a visible, testable
window today. The eventual target embeds CEF directly, at which point `main.ts`
and `preload.ts` are replaced by the engine integration and everything under
`src/` that is not Electron-specific carries over unchanged.

## Launching windows

- **+ Terminal** in the bar, or **Alt+Enter** — ask the compositor to spawn a
  terminal (`kitty`) onto Domicile.
- **+ Browser** in the bar, or **Alt+Shift+Enter** — open a browser window on
  the stage. Its address bar navigates on Enter (an address typed without a
  scheme is loaded over https) and follows the page wherever it goes; the
  window's tab is labelled with the site it is showing.

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
back to a no-op transport when the host injects none. A browser window's page
stays blank there — `<webview>` is Electron's tag — but the bar, the tabs, and
the address bar are all live.

## Test

```sh
bun run --filter @domicile/shell test
```

runs the type check, the unit tests, and the Vite build. The controller's tests
render against happy-dom via [`@domicile/test-support`](../../packages/test-support/README.md).
