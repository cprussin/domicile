# Storybooks

Every component has a story file. Reviewers use it to check the component.

## Required `meta` shape

`meta` sets:

- `component`
- `tags: ["autodocs"]` (except showcases)
- `title`, starting with a category below
- `parameters.docs.description.component`: one sentence on what the
  component does
- `argTypes` for every prop, with a `control` and a `table.category`

## Story `args` — be explicit

Set every boolean prop, and every prop with a meaningful default, in each
story's `args`. Otherwise the controls panel shows different values depending
on which story you opened first.

- A feature story (`Clearable`, `Disabled`) sets that prop to `true` and the
  others to their defaults.
- A story without a content prop (`title`, `footer`, `prefixIcon`) sets it to
  `undefined`. Otherwise Storybook may fill it with `""` or a value left over
  from another story, which breaks `prop === undefined` checks.

## Variant matrices

A component with variants or sizes has an `AllVariations` story. It renders
every combination with `<Variants>` from `src/__test__/Variants.tsx`. See
`Button`, `Input` and `Textarea`.

## Field-aware components

A component that reads `Field` context (such as invalid state) has a
`ToggleValidity` story. It has an `invalid` boolean control and renders the
component inside `<BaseField.Root invalid={invalid}>`. See
`Input.stories.tsx`.

## Story categories

| Prefix | Use for | Examples |
|---|---|---|
| `Layout/` | Page structure and containers | Accordion, Card, Provider, Screen |
| `Navigation/` | Moving between views | Drilldown, TabRail, Tabs |
| `Forms & Inputs/` | Inputs and controls | Autocomplete, Button, Field, Input, Select, Slider, Textarea |
| `Data Display/` | Presenting data | Avatar, Kbd |
| `Overlays/` | Content drawn over other content | ModalDialog, Popover, SlideOver, Toaster |

## Showcases

Showcases demo several components together (for example
`ControlSizes.stories.tsx`). They:

- live in `src/Showcase/`
- use a `title` with no category prefix
- omit `tags: ["autodocs"]`
- set `parameters.options: { showPanel: false }`
