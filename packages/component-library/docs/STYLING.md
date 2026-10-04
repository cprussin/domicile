# Styling (component library)

Styling rules specific to this package. Read
[/docs/guidelines/STYLING.md](/docs/guidelines/STYLING.md) first; its rules
apply here too.

## The `control` recipe

`Button`, `Input` and `Textarea` share the `control` recipe in
`src/pandacss-preset.ts`. It sets:

- inline-flex layout, centered on both axes
- one transition for color, border, shadow, background, outline, opacity and
  filter
- per-size `blockSize`, `minBlockSize`, `borderRadius`, `fontSize`, `gap` and
  `paddingInline`

Rules:

- Apply it as `cx(control({ size }), wrapperStyles({ ... }))`.
- Don't repeat its properties in a component `cva`.
- Override one of its properties only in the wrapper `cva`, so the override
  is visible. Example: `blockSize: "auto"` on `Textarea`.
- Apps use `Button`, `Input` and `Textarea`, not the recipe.

`src/control-sizes.ts` defines `Size`, `SIZES`, `CONTROL_HEIGHT` and
`CONTROL_PADDING_INLINE`. The preset and the controls both read them. Each
control re-exports `Size` and `SIZES`.

## Shared base styles for Input + Textarea

`_control/wrapperBase.ts` exports `wrapperBase = css({...})`. `Input` and
`Textarea` compose it:

```ts
cx(control({ size }), wrapperBase, wrapperStyles({ ... }))
```

It holds the `:has(...)` and `:hover` selectors for hover, focus, invalid,
disabled and resizing states.

Don't write `cva({ base: wrapperBase })`. Panda can't read a value imported
from another file, so those selectors would get no CSS. See
[Sharing base styles across files](/docs/guidelines/STYLING.md#sharing-base-styles-across-files).

## Prefix-icon stack `data-*` attributes

`Input` and `Textarea` swap the prefix icon for a warning icon when invalid.

- The prefix elements carry `data-prefix-stack`, `data-prefix-decoration`,
  `data-prefix-invalid` and `data-prefix-standalone`.
- The wrapper detects invalid state with `:has([data-control][data-invalid])`
  and styles those elements.
- See `_control/PrefixIconStack.tsx` and `_control/wrapperBase.ts`.

## Resize state `data-resizing` attribute

`ResizeHandle` sets `data-resizing` on the textarea during a drag. The
wrapper's hover selectors use `:is(:hover, :has([data-control][data-resizing]))`,
so the hover styles stay on while dragging, even when the pointer leaves the
wrapper.
