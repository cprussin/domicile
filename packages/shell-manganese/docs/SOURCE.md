# Source layout

The engine serves this page over `domicile://` and hands `Shell` the desktop.
`src/` holds only the page. Paths below are under `src/`.

## Entry points

| Path | Contents |
|---|---|
| `index.tsx` | `runManganese(options)`, the default `Shell`, and the public exports (commands, bar items). |
| `Shell.tsx` | Providers and the `DisplayProvider` for every screen. |
| `Desktop.tsx` | Window state, keys, desktop-wide panels, and one `Monitor` per screen. |
| `mount-manganese.tsx` | Mounts the chrome for `runManganese`'s `Shell`. |
| `mount-point.ts` | Creates the element the chrome mounts into. |
| `domicile-elements.d.ts` | JSX type for the engine's `<app>`. React already types `<webview>`. |

## Directories

| Path | Contents |
|---|---|
| `window-management/` | Window model, the state reducer (`window-state.ts`), `Stage` (draws every window), title bars, focus glow, pointer warping, animations. |
| `window-management/tree/` | The sway layout tree: insert, remove, move, layout, resize, focus direction, frames, drag-and-drop. |
| `window-management/floating/` | Floating windows: drag, resize, edge borders, shadow. |
| `window-management/tiled/` | Dragging and edge-resizing tiled windows. |
| `window-management/browser/` | Browser window chrome: address bar, connection indicator, find bar, zoom, file picker requests for component-library's `FilePicker`. |
| `screens/` | The screen source, the per-screen bar (`Monitor.tsx`), and screen adjacency. |
| `keyboard/` | Commands, default bindings, `bindKeys` wiring, held modifiers. |
| `address/` | Parsing typed text as a URL or search, shared by the launcher and address bar. |
| `top-bar/` | Bar columns, default layout, and bar items. |
| `launcher/`, `clipboard/`, `notifications/`, `tray/`, `extensions/` | Those features. |
| `readouts/` | The desk's system readouts, one watch each, shared by every bar and the lock screen. |
| `battery/`, `brightness/`, `volume/`, `clock/` | Bar readouts and where each reads from. |
| `network/`, `bluetooth/` | Bar items on `@domicile-desktop/system-network` and `system-bluetooth`. |
| `lock/` | Lock screen, with the battery, brightness and volume. |
| `theme/` | Theme from the host or the last session. |
| `wallpaper/` | Wallpaper and its photo list. |
| `host/` | Helpers for the desktop: watching an attribute, and spotting a superseded search. |

## Custom elements

`<app>` and `<webview>` have no hyphen, so React treats them as plain HTML
elements and binds no `on…` props for their events. `AppWindow` and
`BrowserWindow` add listeners on a ref.
