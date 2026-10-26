# @domicile-desktop/react

React for a Domicile shell or app: mount it on the desktop, read the desktop
from context, and follow its state with hooks. See
[With React](/docs/WRITING-A-SHELL.md#with-react).

## Usage

```tsx
import { mount } from "@domicile-desktop/react/mount";
import { useFocusedWindow } from "@domicile-desktop/react/windows";

const Focused = () => <p>{useFocusedWindow() ?? "the shell"}</p>;

export const Shell = mount(Focused);
```

- `./mount`: `mount(App)` is a shell's `Shell` or an app's `main`. Draws `App`
  synchronously (the page draws nothing until `Shell` returns) in an element
  of its own with `display: contents`, under `StrictMode`, an error boundary
  that shows what threw, and `<DomicileProvider>`.
- `./domicile-provider`: `<DomicileProvider domicile>`, `useDomicile()` (a
  shell's `Domicile`; throws under an app's) and `useAppDomicile()`.
- `./use-watch`: `useWatch(namespace, type, read)`, `read` again on each
  `type` event, via `useSyncExternalStore`. `read` must answer the same value
  until the event; the desktop's lists keep their identity between changes.
- Hooks over the desktop's core state, each rerendering on change:
  - `./windows`: `useWindows`, `useFocusedWindow`
  - `./displays`: `useDisplays`
  - `./appearance`: `useAppearance`
  - `./session`: `useIdle`, `useLocked`
  - `./portals`: `usePortalRequests`, `useCapturing`, `useBoundShortcuts`,
    `usePortalWallpaper`
- `./fake-domicile`: `<FakeDomicile fake>` for tests. `fake` is a
  `FakeDomicileHost` (`@domicile-desktop/sdk/fake-host`) the test drives;
  without it, a desktop no test drives.

## Dependencies

- `@domicile-desktop/sdk` for the desktop's types and `FakeDomicileHost`.
- `react` and `react-dom` are peers: the shell's own copies.

## Test

```sh
bun run turbo test --filter @domicile-desktop/react
```
