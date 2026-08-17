# Styling (component library)

The cross-cutting Panda CSS rules — tokens, patterns, conditions,
extractor pitfalls, the static-CSS mandates — live in
[/docs/guidelines/STYLING.md](/docs/guidelines/STYLING.md) and apply to this package too. **Read
that first.** This file only covers the conventions and machinery that
are specific to the component library itself.

## The `control` recipe

Sized form controls — `Button`, `Input`, `Textarea` — share the `control`
recipe from `src/pandacss-preset.ts`. It encapsulates:

- `display: inline-flex`, `flexDirection: row`, `alignItems: center`,
  `justifyContent: center`.
- The shared transition (`color`/`border-color`/`box-shadow`/
  `background-color`/`outline-color`/`opacity`/`filter`) so every control
  fades identically.
- Per-size `blockSize`, `minBlockSize`, `borderRadius`, `fontSize`,
  `gap`, and `paddingInline`.

Every control's wrapper applies it via
`cx(control({ size }), wrapperStyles({ ... }))`. **Do not duplicate**
these properties in component cvas — extend on top of the recipe instead.
If a property the recipe provides needs to be overridden (e.g.
`blockSize: "auto"` on Textarea), do it explicitly in the wrapper cva so
the override is visible.

The `Size` union and `SIZES` array are defined in `src/control-sizes.ts`
and re-exported by each control:
`export { SIZES, type Size } from "../control-sizes";`. Per-size
constants (`CONTROL_HEIGHT`, `CONTROL_PADDING_INLINE`) also live there
as the single source of truth that the preset and consumers both read
from.

Apps consuming the library should NOT reach for the `control` recipe
directly — they should use `Button`, `Input`, `Textarea` from the
library. The recipe is an implementation detail of the library's sized
controls.

## Shared base styles for Input + Textarea

`_control/wrapperBase.ts` exports `wrapperBase = css({...})` — a
className that both `Input.tsx` and `Textarea.tsx` compose via
`cx(control({size}), wrapperBase, wrapperStyles({...}))`. It carries the
`:has(:disabled)` / `:has([data-control][data-invalid])` /
`:hover:not(...)` matrix that drives the wrapper's hover, focus, invalid,
and resize-in-progress styling.

This is the canonical example of the "Sharing base styles across files"
pattern in [/docs/guidelines/STYLING.md](/docs/guidelines/STYLING.md#sharing-base-styles-across-files).
Don't restructure it as `cva({ base: wrapperBase })` — the cross-file
const reference inside a `cva` is opaque to Panda's static extractor and
the selectors silently stop applying. See the comment at the top of
`wrapperBase.ts` for the gory details.

## Prefix-icon stack `data-*` attributes

`Input`/`Textarea` use a stack of `data-prefix-stack`,
`data-prefix-decoration`, `data-prefix-invalid`, and
`data-prefix-standalone` attributes to drive the icon-to-warning swap
animation on the invalid state. The wrapper detects validity via
`:has([data-control][data-invalid])` and styles the prefix children
accordingly. See `_control/PrefixIconStack.tsx` and `_control/wrapperBase.ts`
for the full pattern.

## Resize state `data-resizing` attribute

`ResizeHandle` sets `data-resizing=""` on the textarea while a drag is
in progress and removes it on finish. The wrapper's hover-state
selectors use `:is(:hover, :has([data-control][data-resizing]))` so the
hover border (and the handle's hover color) persist for the full
duration of the drag, even when the pointer leaves the wrapper.
