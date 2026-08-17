# Storybooks

Every component MUST have a storybook. It's the live documentation surface
and the primary place reviewers will look to verify the component.

## Required `meta` shape

The `meta` block MUST set:

- `component`
- `tags: ["autodocs"]` (showcases are the exception — see below)
- `title` with one of the category prefixes below
- `parameters.docs.description.component` — one short sentence describing
  what the component does
- `argTypes` for **every** prop the component accepts, with a sensible
  `control` and `table.category`

## Story `args` — be explicit

Every story SHOULD declare explicit values for every boolean prop in its
`args` (and for any other prop that has a meaningful default), so the
controls panel always shows definite values regardless of which story the
user visits first.

- Stories that exercise a specific feature (e.g. `Clearable`, `Disabled`,
  `Rounded`) set that prop to `true` and leave the others as their normal
  defaults — explicitly, not by omission.
- Stories that intentionally omit a content prop (no `title`, no `footer`,
  no `prefixIcon`, etc.) should set it to `undefined` explicitly. Otherwise
  Storybook's text controls can populate it with an empty string, or a
  value can persist from a previously-visited story, defeating the omission.

## Variant matrices

For components with variants/sizes, include a story (typically named
`AllVariations`) that renders every combination using the shared
`<Variants>` helper from `src/__test__/Variants.tsx`. See `Button`,
`Input`, and `Textarea` for examples.

## Field-aware components

For components whose behavior depends on `Field` context (e.g. invalid
state), include a `ToggleValidity` (or equivalent) story with an `invalid`
boolean control and a `render` function that wraps the component in
`<BaseField.Root invalid={invalid}>`. See `Input.stories.tsx` for the
pattern.

## Story categories

The `title` MUST start with one of these prefixes (or live under
`Showcase/` for cross-component compositions):

| Category | Use for | Examples |
|---|---|---|
| `Layout/` | Page structure and container components | AppRoot |
| `Navigation/` | Components for navigating between views | MenuBar, Tabs |
| `Forms & Inputs/` | Interactive input and control components | Button, Field, Input, Textarea |
| `Data Display/` | Components for presenting data | Badge, StatusMessage |
| `Overlays/` | Components that render over other content | ModalDialog, Popover, Toast |

## Showcases

Showcase stories (e.g. `ControlSizes.stories.tsx`) live under
`src/Showcase/`, use a top-level `title` with no category prefix, skip
`tags: ["autodocs"]` (showcases are visual demos, not API docs), and set
`parameters.options: { showPanel: false }` to hide the addon panel.
