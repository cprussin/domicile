# @domicile-desktop/sdk

Types and helpers for a Domicile shell: the desktop it is handed, input
routing for `<app>` and `<webview>`, keybindings and the `Shell` export.

- Published to npm. To write a shell, start with
  [WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md); this README is the package
  reference.
- Ships built JavaScript and `.d.ts` from `dist/`. Run `bun run build` before
  anything outside the workspace imports it.

## Usage

```ts
import { registerElements } from "@domicile-desktop/sdk/register-elements";
import type { Shell as ShellModule } from "@domicile-desktop/sdk/shell";

export const Shell: ShellModule = (root, domicile) => {
  registerElements(domicile);

  const show = () => {
    // Render `domicile.windows` as `<app app-id="…">` elements into `root`.
  };
  show();
  domicile.addEventListener("windowschanged", show);
};
```

- Domicile calls `Shell(root, domicile)` once. `domicile` is the only copy of
  the desktop; there is no global.
- Nothing to await. The first call on `domicile` binds the channel.
- State is readonly attributes (`windows`, `browserWindows`, `displays`,
  `theme`, …), each with a bare `<name>changed` event. Read, then listen.
- Moments (`shortcut`, `focusrequested`, …) are events. The engine holds each
  type until its first listener exists.
- `searchFiles`, `previewFile` and `searchApps` return promises. A newer call
  rejects the older with an `AbortError`.
- Only Domicile calls a shell. Develop against the real desktop with
  `./scripts/dev-shell.sh <shell>`.
- Render `<app app-id="…">` and `<webview window="…">` as normal DOM. CSS
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
| `./domicile-host` | `DomicileHost`: the type of the desktop `Shell` is handed, mirroring the engine's IDL. |
| `./shell` | `Shell`: the export a shell module must provide. Domicile calls it once with the element to draw in. |
| `./register-elements` | Input routing for `<app>`. |
| `./app-element`, `./webview-element` | Types and event names for `<app>` and `<webview>`. |
| `./focus-app`, `./focus-chrome` | Move the keyboard to a client or back to the page. Use these, not `domicile.focusApp` / `domicile.focusChrome`, which only move the compositor's seat. |
| `./windows` | `windowOf` (a popup's toplevel window) and `surfaceSizeOf` over `domicile.windows`. |
| `./bind-keys` | `bindKeys`: grab a shell's own chords by name and handle them by mode. `./key-action` and `./own-keybindings` are its parts. |
| `./fake-host` | `FakeDomicileHost`: a desktop for a shell's tests. |
| `./extension`, `./tray`, `./notification`, `./audio`, `./theme`, `./file-preview`, `./display-transform` | Data types and Zod schemas for what the desktop holds. |

Internals, not needed by shells: `./matrix`, `./measure`,
`./element-transform`, `./surface-coordinates`, `./input`, `./cursor-shape`.

The compositor's JSON socket protocol lives in
[`@domicile-desktop/e2e-harness`](../e2e-harness/README.md); a page never
speaks it.

## Dependencies

- `zod` only. Its schemas parse the keywords and rows a newer engine may send
  unknown values for, such as `./cursor-shape`.

## Test

```sh
bun run turbo test --filter @domicile-desktop/sdk
```

- DOM suites run on happy-dom via
  [`@domicile-desktop/test-support`](../test-support/README.md).
- happy-dom does no layout, so routing tests pass a `measure` stub:
  `registerElements(domicile, { measure })`.
- React's dev build logs an unknown-tag warning for `<app>` in tests only.
