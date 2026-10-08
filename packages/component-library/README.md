# @domicile-desktop/component-library

Shared React UI components for every Domicile app, plus the Panda CSS preset
the other packages extend.

- Components wrap [`@base-ui/react`](https://base-ui.com) where it has a
  primitive. base-ui handles focus, keyboard navigation, portals and
  validation. This package adds styling and a simpler API.
- Apps use these components instead of raw HTML buttons, inputs or dialogs.
  If one is missing, add it here. See
  [/docs/guidelines/STYLING.md](../../docs/guidelines/STYLING.md).

## Exports

Each export is `@domicile-desktop/component-library/<name>`.

| Name | What it is |
|---|---|
| `Accordion` | Stack of sections that open and close. |
| `Autocomplete` | Text field with a suggestion list the caller supplies and ranks. |
| `Avatar` | Avatar with an initials or gradient fallback. |
| `Button` | Button or link, with variants and sizes. |
| `Card` | Raised surface with optional title and footer. |
| `Drilldown` | View that slides a second panel in from the side, with a back button. |
| `Field` | Label, control and validation message. |
| `FilePicker` | Keyboard-first file picker over its positioned parent. |
| `file-request` | `FileRequest` and `ChooserMode`: what `FilePicker` asks for and how it answers. |
| `Input` | Text input with prefix icon, clear button and invalid state. |
| `Kbd` | Keyboard key cap. |
| `list-walk` | Arrow-key movement of a highlight through a list while focus stays in an input. |
| `ModalDialog` | Modal dialog with `title`, `footer` and `trigger` props. |
| `ContextMenu` | Menu opened at a point, such as a right click's. |
| `PortalDialogs` | Every dialog applications ask for through the desktop portal. Mount one per shell with `host={domicile}`; it refuses kinds it cannot draw. `omitScreenCasts` leaves screen casts out of its indicator. See [PORTALS.md](/docs/PORTALS.md). |
| `source-name` | `sourceName`: how a screen cast's source is named. |
| `Popover` | Non-modal panel anchored to the control that opened it. |
| `Provider` | base-ui `DirectionProvider` wrapper. Every app roots its tree in it. |
| `Screen` | Renders its children once per selected display. |
| `DisplayProvider` | Supplies the host's displays to `Screen`. |
| `display-source` | `Display` and `DisplaySource` types for `DisplayProvider`. |
| `Select` | Select / listbox. |
| `SlideOver` | Drawer anchored to a screen edge. |
| `Slider` | Single-value range slider drawn in `currentcolor`. |
| `Switch` | On/off switch with its label. |
| `Tabs` | Tab set built from a `tabs` array, with sizes. |
| `TabRail` | Vertical tab rail with brand slot, footer and collapse. |
| `Textarea` | Auto-sizing textarea with a resize handle. |
| `Toaster` | Stack of toasts in a corner. The caller renders each card. |
| `ThemeProvider` | Light/dark theme state. Sets `data-theme` on `<html>`. |
| `ThemeSwitch` | Button that flips the theme. |
| `useApps` | Hook: names and icons of applications by app id, from their desktop entries. |
| `usePictureUrl` | Hook: a URL an `<img>` can show for a file read through the SDK's `system`. |
| `usePortalWallpaper` | Hook: the pictures applications set through the Wallpaper portal, as paths. |
| `theme-core`, `theme-source`, `standalone-theme-source` | Theme types and sources. Use the standalone source where there is no compositor, such as Storybook. |
| `control-sizes` | `Size` type and `SIZES` array for sized controls. |
| `spacing` | rem value of one spacing step, for runtime math. |
| `pandacss-preset` | `domicilePreset`, extended by every package's `panda.config.ts`. |
| `vite-shell` | `shellBuild({ entry })`: the Vite config a shell needs so Domicile can load it. See the comments in `src/vite-shell.ts`. |

## Scripts

```sh
bun run start:dev        # Storybook on port 4000
bun run build:storybook  # build Storybook into storybook-static/
bun run start:prod       # serve that build on port 4000
bun run prepare          # Panda codegen into styled-system/
bun run test:unit        # bun:test + happy-dom
bun run test:types       # tsc --noEmit
```

## More

- [docs/AGENTS.md](./docs/AGENTS.md): rules for adding or changing a
  component.
