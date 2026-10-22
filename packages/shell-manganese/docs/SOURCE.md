# Source layout

The engine serves this page over `domicile://` and hands `Shell` the desktop.
`src/` composes manganese's packages into that page. Paths below are under
`src/`. Each package's own layout is in its source; see the
[README](../README.md#packages) for what each holds.

| Path | Contents |
|---|---|
| `index.tsx` | `runManganese(options)`, the default `Shell` and `DEFAULT_BAR`. |
| `Shell.tsx` | Providers and the `DisplayProvider` for every screen. |
| `Desktop.tsx` | Window state, keys, desktop-wide panels, the contexts bar items read, and one `Monitor` per screen. |
| `default-bars.tsx` | `DEFAULT_BAR` and the lock screen's `LOCK_BAR`. |
| `shows-sharing.ts` | Whether a bar has the sharing item, so the portal dialogs leave screen casts to it. |
| `mount-manganese.tsx` | Mounts the chrome for `runManganese`'s `Shell`. |
| `mount-point.ts` | Creates the element the chrome mounts into. |
| `screens/` | `Monitor` (a screen's bar) and `NoScreens`. |
| `theme/` | Theme from the host or the last session. |

`package.json` also depends on items no default bar uses, such as
`manganese-bar-module-gmail` and `manganese-bar-module-google-messages`. A
config's `@domicile-desktop/*` imports resolve from this package in Domicile's
install, so an item it does not depend on cannot be imported.

## Custom elements

`<app>` and `<webview>` have no hyphen, so React treats them as plain HTML
elements and binds no `on…` props for their events. `AppWindow` and
`BrowserWindow` in `@domicile-desktop/manganese-window-management` add
listeners on a ref. Their JSX types are
`@domicile-desktop/manganese-host/domicile-elements`.
