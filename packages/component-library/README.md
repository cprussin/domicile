# @domicile/component-library

The shared React UI primitives every Domicile app builds on. Components wrap
[`@base-ui/react`](https://base-ui.com) where a primitive exists — so focus
management, keyboard navigation, portals, and validation come from base-ui —
and add the project's styling and ergonomic API on top. This package also
owns the design system: the Panda CSS preset (tokens, the shared `control`
recipe) that every other package extends.

Apps MUST build on these primitives rather than rolling their own buttons,
inputs, or dialogs from raw HTML. If a primitive is missing, add it here and
consume it — don't fork. See [/docs/guidelines/STYLING.md](../../docs/guidelines/STYLING.md).

## Exports

| Export | What it is |
|---|---|
| `@domicile/component-library/Button` | Polymorphic button (`<button>` / `<a>`), variants + sizes. |
| `@domicile/component-library/Input` | Text input with prefix-icon / clearable / invalid states. |
| `@domicile/component-library/Textarea` | Auto-sizing textarea with a resize handle. |
| `@domicile/component-library/Field` | Label + control + validation-message wrapper (base-ui Field). |
| `@domicile/component-library/Select` | Select / listbox (base-ui Select). |
| `@domicile/component-library/Tabs` | Tabbed container (base-ui Tabs): config-driven `tabs` array, a sliding active underline, `size` variants, inset focus ring. |
| `@domicile/component-library/TabRail` | Vertical rail of tabs with a brand slot, footer, and collapse. |
| `@domicile/component-library/Card` | Elevated surface with optional title / footer. |
| `@domicile/component-library/ModalDialog` | Modal dialog with flattened `title` / `footer` / `trigger` API. |
| `@domicile/component-library/SlideOver` | Edge-anchored drawer (base-ui Dialog). |
| `@domicile/component-library/Avatar` | Avatar with initials / gradient fallback. |
| `@domicile/component-library/Kbd` | Keyboard-shortcut key cap. |
| `@domicile/component-library/Screen` | Lays its children over one of the desktop's displays, once per display it selects. |
| `@domicile/component-library/DisplayProvider` | The desktop the host described, for the `<Screen>`s below it. |
| `@domicile/component-library/display-source` | The `Display` / `DisplaySource` types a `DisplayProvider` is fed. |
| `@domicile/component-library/Provider` | base-ui `DirectionProvider` wrapper every app roots its tree in. |
| `@domicile/component-library/ThemeProvider` | Theme state (`light` / `dark` / `system`) and the `<html data-theme>` side effect. |
| `@domicile/component-library/ThemeSwitch` | The toggle that cycles the theme preference. |
| `@domicile/component-library/control-sizes` | The `Size` union / `SIZES` array the sized controls share. |
| `@domicile/component-library/spacing` | The rem value of one step on the spacing scale, for runtime math. |
| `@domicile/component-library/pandacss-preset` | The `domicilePreset` every package's `panda.config.ts` extends. |

Styling goes through the theme defined in the preset
(`pandacss-preset.ts`) — `color`, `spacing`, `borderRadius`, etc. — with
both dark (default) and light (`data-theme="light"`) values. Component
variants are exposed as explicit props, never a `className` passthrough;
`data-*` attributes communicate variant/state to CSS.

## Conventions

- Every component has a Storybook story (`*.stories.tsx`) with `argTypes` for
  every prop.
- Every component has tests (`*.test.tsx`) using `bun:test` +
  `@testing-library/react`.
- Icons come from `@phosphor-icons/react/dist/ssr/<IconName>` (the
  `*Icon`-suffixed name), never the barrel — see
  [/docs/guidelines/ICONS.md](../../docs/guidelines/ICONS.md).

The rules for adding or changing a component (directory layout, base-ui
wrapping, props typing, the `control` recipe, storybook categories, testing)
live in [`docs/AGENTS.md`](./docs/AGENTS.md) and the topic docs it indexes.

## Scripts

```sh
bun run start:dev    # Storybook dev server on port 4000
bun run build:storybook  # build static Storybook
bun run prepare      # panda codegen (generates styled-system/)
bun run test:unit    # bun:test + happy-dom
bun run test:types   # tsc --noEmit
```
