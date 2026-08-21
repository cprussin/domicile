# @domicile/shell

The bundled reference chrome: a rail carrying a tab per open window, the
launchers, the theme toggle and a clock, beside a stage that shows one window at
a time. It is the app Domicile ships to prove the model end to end — every pixel
of it is ordinary web content, and each Wayland client on the stage is a real
`<domicile-app>` element that takes ordinary CSS.

The chrome is a React tree built entirely from
[`@domicile/component-library`](../../packages/component-library/README.md): the
rail is its `TabRail`, the launchers and a browser window's controls are its
`Button`, the address bar its `Input`, the empty stage its `Card` and `Kbd`, the
theme toggle its `ThemeSwitch`. Styling is Panda CSS from the library's preset —
the shell defines no stylesheet of its own.

A window is either a Wayland client the host announced or a browser window the
shell opened itself; both get a tab, and the rail is what switches between them.
Only the window on the stage has a box, so the SDK reports the rest to the host
as no longer composited. The window that takes the stage takes the keyboard with
it, so what the user just opened or switched to is typeable without a click: a
client's keyboard goes to the host, a browser window's to its page.

## Layout

| Path | What |
|---|---|
| `src/renderer.tsx` | Renderer entry: applies the theme, builds the `BridgeClient`, registers the SDK's custom elements, mounts `<Shell>`, reports the frame timing. |
| `src/Shell.tsx` | The chrome: the rail, the launchers, the stage, and the keybindings. |
| `src/useShellWindows.ts` | Wires host events and user actions into the reducer, and the host's frames into the portal elements. |
| `src/shell-state.ts` | Every change the window list can undergo, as one pure reduction. |
| `src/shell-window.ts` | The window model: a client's portal or a browser window. |
| `src/app-elements.ts` | The live `<domicile-app>` elements by app id — where frames, resizes and cursors are applied. |
| `src/AppWindow.tsx` | A Wayland client's window: one `<domicile-app>` portal. |
| `src/BrowserWindow.tsx` | A browser window: an address bar (back / forward / stop / reload) over a `<domicile-webview>`. |
| `src/Clock.tsx` | The rail footer's live clock. |
| `src/window-styles.ts` | What every window on the stage shares. |
| `src/main.ts` | Electron main process: opens the window, and prints and exits on the renderer's behalf. |
| `src/preload.ts` | Holds the Unix socket to the compositor and exposes it to the page as `window.domicileTransport`. |
| `src/socket-path.ts` | Where that socket is, off the renderer's own command line. |
| `src/socket-failure.ts` | What a dead compositor socket costs the shell. |
| `src/ipc-channels.ts` | The channel names main and preload agree on. |
| `src/domicile-elements.d.ts` | The SDK's custom elements, as JSX. |

Electron is the prototype's host: it renders the chrome as a visible, testable
window today. The eventual target embeds CEF directly, at which point `main.ts`
and `preload.ts` are replaced by the engine integration and everything under
`src/` that is not Electron-specific carries over unchanged.

React owns this DOM, so the chrome writes `<domicile-app>` in JSX rather than
letting the SDK's `aliasTag` upgrade a short `<app>` tag — a MutationObserver
that swaps nodes out from under the reconciler is not something React tolerates.
`aliasTag` remains in the SDK for chromes that build their DOM themselves.

## Launching windows

- **Terminal** in the rail footer, or **Alt+Enter** — ask the compositor to
  spawn a terminal (`kitty`) onto Domicile.
- **+** in the rail header, or **Alt+Shift+Enter** — open a browser window on
  the stage. Its address bar navigates on Enter (an address typed without a
  scheme is loaded over https) and follows the page wherever it goes; the
  window's tab is labelled with the site it is showing.

A tab reorders by drag, or by Alt+Up / Alt+Shift+Up (and their Down
counterparts) on a focused row. A browser window's tab closes it; a client's
does not, because the chrome can take a client's window off the stage but has no
way to end the client.

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
Vite's dev server, for styling work without a compositor: `renderer.tsx` falls
back to a no-op transport when the host injects none. A browser window's page
stays blank there — `<webview>` is Electron's tag — but the rail, the tabs, and
the address bar are all live.

`styled-system/` is Panda's generated output, produced by `bun run prepare`
(run automatically as a turbo dependency of the build, type check, and tests)
and not checked in.

## Test

```sh
bun run --filter @domicile/shell test
```

runs the type check, the unit tests, and the Vite build. The components render
against happy-dom via
[`@domicile/test-support`](../../packages/test-support/README.md).
