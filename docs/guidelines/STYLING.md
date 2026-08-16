# Styling

The styling system, conventions, and mandates that apply to every package
in this repo.

> **Status.** `@domicile/component-library` and its Panda preset do not exist
> yet; `apps/shell` still styles its chrome with a plain stylesheet, which is
> the one grandfathered exception. This doc is the spec that UI work must meet
> from here: the first package to build real UI creates the component library
> and its preset as described below, and the shell migrates onto it. Token
> names and values below are inherited from the sibling `argo-browser` repo and
> are the starting point for that preset, not a description of tokens already
> defined here.

## Mandates

- **All packages building UI MUST use [Panda CSS](https://panda-css.com).**
  No StyleX, CSS modules, scoped-CSS files, Tailwind, or any other styling
  system. Styles live in `.tsx` / `.ts` next to the component that uses
  them.
- **All packages MUST extend the `@domicile/component-library` Panda preset.**
  It defines the design tokens (semantic colors, spacing scale, typography,
  durations, easings, shadows, z-indices, opacities, keyframes) and the
  shared `control` recipe used by sized form controls. Theming flows from
  this preset; no package defines its own competing tokens.
- **All packages MUST use components from `@domicile/component-library` where
  possible** — `Button`, `Input`, `Textarea`, `Field`, `Avatar`, `Kbd`,
  `ModalDialog`, etc. Build app-specific UI on top of those primitives
  instead of rolling new buttons / inputs / dialogs from raw HTML. If a
  primitive is missing from the library, add it to the library and consume
  it — don't fork.

## Setup for a new package

1. Add the catalog dependencies to the package's `devDependencies`
   (`@pandacss/dev`, `postcss`) and to its `dependencies`
   (`@domicile/component-library` as `workspace:*`).
2. Create `panda.config.ts`:
   ```ts
   import { defineConfig } from "@pandacss/dev";
   import { domicilePreset } from "@domicile/component-library/pandacss-preset";

   export default defineConfig({
     exclude: [],
     include: ["./src/**/*.{ts,tsx}"],
     jsxFramework: "react",
     outdir: "styled-system",
     preflight: true,
     presets: [domicilePreset],
   });
   ```
3. Wire the PostCSS plugin to your bundler. For Vite-based apps, add the
   plugin in `vite.<entry>.config.ts`:
   ```ts
   import pandacssPostcssPlugin from "@pandacss/dev/postcss";
   import { defineConfig } from "vite";

   export default defineConfig({
     css: { postcss: { plugins: [pandacssPostcssPlugin] } },
     // ... rest of config
   });
   ```
4. Add the layer declaration to the package's entry CSS file (and import
   it from the renderer entry point):
   ```css
   @layer reset, base, tokens, recipes, utilities;
   ```
5. Add a `prepare` script to `package.json`:
   `"prepare": "panda codegen --silent"`. The turbo `prepare` task runs
   automatically as a dependency of `build` / `test:types` / `test:unit`.
6. `styled-system/` is already covered by the root `.gitignore`.

## Import paths

All styling imports come from the local generated `styled-system/...`:

```tsx
import { css, cva, cx } from "../../styled-system/css";
import { flex, hstack, center } from "../../styled-system/patterns";
```

Adjust the relative path to match your source layout (consumers of the
component library should resolve their *own* generated `styled-system`,
not the library's — each package's Panda config emits its own CSS bundle
keyed off the same preset).

## Panda's static extractor — the #1 source of bugs

Panda extracts styles at build time by reading literal values inside calls
to its runtime helpers (`css`, `cva`, patterns). Values it can't resolve
statically produce class names with **no CSS rule attached** — the element
gets a class but the property silently doesn't apply.

The extractor canNOT trace into:

- **Helper return values consumed by Panda functions.**
  `cva({ base: wrapperBase })` where `wrapperBase` is an object exported
  from another file → opaque. Same for `flex(myHelper())`,
  `compoundVariants: someHelper()`. Fix: publish shared styles as a
  `css(...)` className and compose with `cx(...)`, or inline the literal
  at the call site.
- **Runtime construction.** `compoundVariants: SIZES.map((size) => ({ ...,
  css: { foo: TABLE[size] } }))` → opaque. Fix: write out the literal
  array entries.
- **Cross-file const lookups in consumer cvas.** `paddingInline:
  CONSTANTS[size]` inside a consumer `cva` → risky. The preset's
  `defineRecipe` *does* evaluate these (the preset is fully loaded at
  Panda's build time), but consumer cvas don't. Prefer inlined literals
  in consumer cvas, with a comment linking back to the source table.

What the extractor handles reliably:

- Object literals passed directly: `css({ color: "foreground" })`,
  `cva({ variants: { size: { md: { padding: 4 } } } })`.
- Ternaries with literal branches:
  `paddingBlockStart: title === undefined ? 10 : 2`.
- Pattern `.raw()` composition anywhere inside a cva object — `base`,
  `variants`, or `compoundVariants`:
  `size: { md: circle.raw({ size: 12 }) }`,
  `base: center.raw({ inset: 0 })`. See "Composing patterns with `cva`"
  below for when to reach for it.

When a property mysteriously stops applying, suspect the extractor first.
Inspect the element — if you see the expected class (`pbs_10`, `bd_muted`,
…) but no matching CSS rule in the bundle, it's an extraction failure.

## Tokens are required

Hardcoded literal values (px/rem dimensions, em letter-spacing, hex/rgb
colors, raw shadows, easing functions, etc.) are **not permitted** in
styles. Every numeric, color, and timing value must resolve through a
Panda token. The two narrow exceptions:

- **Border-width-related calculations.** Use the literal string `"1px"`
  when referring to a wrapper's 1px border — this matches how the border
  is declared (`border: "1px solid {colors.border}"`) and makes the
  connection obvious. Negative compensations like `marginBlock: "-1px"`
  follow the same rule.
- **CSS keywords with no token equivalent** — `"none"`, `"auto"`,
  `"transparent"`, `0`, `"100%"`, `"inline-flex"`, etc. — are fine as
  literals.

In every other case, find or add a token (and prefer finding to adding).

### Spacing

Use bare numbers for spacing values: `paddingBlock: 1.5`,
`marginInlineEnd: -2`. The domicile preset extends the default Panda scale
with every quarter-step from `0` through `1000` (`0.25`, `0.5`, `0.75`,
…, `1000`), each resolving to `step × 0.25rem`. There is no need to use
rem literals for spacing; if a fractional value looks unusual
(`paddingBlock: 2.75`), that's correct as long as the math works.

Use the same numeric values for `inset*`, `inlineSize` / `blockSize`,
`gap`, etc. — they all read from the spacing scale.

For hardcoded non-token sizing values (rare), use **rem**, not px. E.g.
`lineHeight: "1.125rem"`. The exception is the 1px border above.

### Colors — derive, don't add

Stick to the **semantic** color tokens defined by the domicile preset:

| Token | Use for |
|---|---|
| `foreground` / `background` | Primary text / surface |
| `muted` / `textTertiary` | De-emphasized text |
| `border` / `borderStrong` | Standard / emphasized borders |
| `card` | Card / elevated surface backgrounds |
| `accent` | Primary brand / focus / selection |
| `danger` / `warning` / `success` | Status colors |
| `backdrop` | Modal/popover backdrop overlay |
| `skeleton` | Loading skeleton fills |

**Do not reach for the palette** (`colors.red.500`, etc.). The palette is
for the preset to derive semantic tokens *from* — not for consumer-side
usage.

**Do not introduce new semantic tokens lightly.** If you need a slightly
different shade of an existing semantic color (a hover color, a softer
variant, a tinted background), derive it inline with `color-mix(...)`
referencing the existing token:

```ts
backgroundColor: "color-mix(in oklab, {colors.foreground} 60%, {colors.background})",
borderColor: "color-mix(in oklab, {colors.danger} 70%, {colors.background})",
```

Panda's `{path}` placeholder substitution resolves token references
inside string values at build time. This is the pattern for all derived
hover, active, and tinted states.

Only promote a derived value to a new semantic token in the
`@domicile/component-library` preset (`pandacss-preset.ts`) when it is
**genuinely reusable across multiple components/apps** and represents a
distinct semantic role. Updating one site is not a reason to add a token.

### Light + dark themes

Every primitive semantic color in the domicile preset has both dark (`base`)
and light (`_light`) values. Setting `data-theme="light"` on `<html>`
flips the page to light mode via Panda's built-in `_light` condition;
no attribute (or any other value) leaves the page in dark mode, which
is the implicit default.

The primitive tokens are the only ones with per-theme values:
`foreground`, `background`, `accent`, `danger`, `success`, `warning`.
Every derived token (`border`, `borderStrong`, `card`, `dangerSoft`,
`muted`, `skeleton`) resolves at CSS time through
`color-mix(... var(--colors-foreground), var(--colors-background))` —
when the foreground/background CSS variables flip, the derived tokens
recompute automatically. **Don't add `_light` overrides to derived
tokens** — let the math follow.

The rule is symmetric for consumers: any color you reach for must
resolve through a semantic token (or a `color-mix(...)` of one). A
literal palette reference like `{colors.neutral.900}` looks fine in
dark mode and breaks in light mode. If you find yourself wanting a
specific dark or light value, you almost always want the semantic
equivalent (`background`, `card`, `foreground`, …) instead.

### Other token categories

| Token category | Notes |
|---|---|
| `colors.<palette>.<step>` | Default Tailwind-style palette. **Preset only** — do not use directly. |
| `fontSize`, `fontWeight`, `letterSpacing`, `lineHeights` | Default Panda typography scales. `lineHeights.normal` (1.5), `lineHeights.tight` (1.25), etc. |
| `borderRadius` | Named scale: `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `4xl`, `full`. Per-size radii that aren't in this scale can be expressed by interpolating spacing tokens (e.g. `borderRadius: "{spacing.4}"`). |
| `shadows.md` | Default Panda shadow scale. |
| `shadows.lifted`, `shadows.modal` | Domicile preset. `lifted` is a soft, broad drop shadow for floating surfaces (e.g. the message composer); `modal` is the heavier elevation used by dialogs. |
| `durations.fastest/faster/fast/normal/slow/slower/slowest/pulse` | Used in `transition` shorthands. |
| `easings.default/linear/in/out/in-out` | Used in `transition` shorthands. |
| `opacity.disabled` (0.6), `opacity.dragging` (0.4), `opacity.pulseMin` (0.3) | Domicile preset. |
| `zIndex.modalBackdrop` / `zIndex.modal` | Domicile preset. Stacking for portaled overlays. |
| `fonts.mono` | Domicile preset. |
| Keyframes (`pulse`, etc.) | Defined in `pandacss-preset.ts`. Reference by name: `animationName: "pulse"`. **Never** define keyframes inline. |

## css vs cva vs sva

**All `css(...)` calls live after the component/function definition**,
not at the call site. Bind them to a named const and reference that const
from the JSX. Same rule as `cva` — the JSX shows *which* style is
applied, the definitions below show *what* the style is.

```tsx
// good — definitions live below
export const Thing = () => <div className={rootStyles}>…</div>;

const rootStyles = css({ padding: 4, color: "foreground" });

// avoid — inline css() at the call site
export const Thing = () => (
  <div className={css({ padding: 4, color: "foreground" })}>…</div>
);
```

Same rule applies to pattern helpers (`flex(...)`, `vstack(...)`,
`center(...)`, etc.) and to `cx(...)` compositions: hoist the result to a
named const declared after the component.

**Use `cva` for size/variant/state recipes** — anywhere you'd otherwise
switch on a prop to pick a style. Place cva blocks *after* the
component/function definition.

**Use `sva` (slot recipes) sparingly** — only when a component truly has
multiple slots that share variant logic. Most components don't need this;
a single cva plus a few named `css` consts is usually clearer.

When composing multiple class strings onto one element, join them with
`cx(...)`:

```tsx
className={cx(
  controlRecipe({ size }),
  wrapperStyles({ rounded, size }),
  iconStyles,
)}
```

Panda's atomic CSS deduplicates property-by-property at build time, so
the final order in the className doesn't need to mirror a precedence
ranking — last-write-wins within a single rule is enough.

### Sharing base styles across files

If multiple components need the same base style block, publish it as a
`css(...)` className (NOT a plain object) and compose with `cx(...)` at
each consumer. Example:

```ts
// shared/wrapperBase.ts
export const wrapperBase = css({ /* lots of selectors */ });

// consumer.tsx
className={cx(controlRecipe({ size }), wrapperBase, localStyles({ ... }))}
```

Consuming the const as `cva({ base: wrapperBase })` is opaque to the
extractor — the cross-file const reference produces classes with no CSS
rules in the bundle. The `css(...)` approach extracts at the declaration
site, so it's bulletproof.

## Prefer Panda patterns over hand-rolled css

Use the patterns from `styled-system/patterns` for layout primitives:

| Pattern | Replaces |
|---|---|
| `flex({ ... })` | `{ display: "flex", flexDirection, alignItems, justifyContent, ... }` |
| `center({ inline?: bool, ... })` | `{ display: flex/inline-flex, alignItems: center, justifyContent: center, ... }` |
| `hstack({ gap, justify, ... })` | flex row + items center + gap |
| `vstack({ gap, justify, ... })` | flex column + items center + gap |
| `stack({ direction, gap, ... })` | flex with direction + gap |
| `grid({ columns, gap, minChildWidth, ... })` | `{ display: "grid", ... }` |
| `circle({ size })` | a circular flex container of the given size |

The pattern handles `display` and the layout-related properties; pass
other properties through via rest props. Use `flex({ direction: "column",
gap: 4 })` instead of hand-writing `{ display: "flex", flexDirection:
"column", gap: 4 }`.

`vstack` and `hstack` set `align-items: center` by default — choose
`flex` when you want children to fill the cross axis (e.g. inputs in a
form field).

### Composing patterns with `cva` — prefer `.raw()` over `cx`

When a `cva` recipe needs the styles of a pattern (e.g. a `circle` whose
size varies per recipe variant), prefer composing inline via the
pattern's `.raw()` form rather than emitting a separate pattern className
and joining with `cx`. The `.raw()` form returns the pattern's style
object, which the cva can spread directly:

```ts
// preferred — single className, single rule set
const rootStyles = cva({
  variants: {
    size: {
      sm: circle.raw({ fontSize: "sm", size: 8 }),
      md: circle.raw({ fontSize: "md", size: 12 }),
    },
  },
});

// avoid — two className strings joined at the call site
className={cx(circle({ size: dim }), rootStyles({ size }))}
```

Embedding the pattern keeps the variant's full styling co-located,
avoids a parallel size-to-dimension table at the consumer, and produces
one className instead of two.

The same applies in cva `base`. If a pattern's layout is shared across
every variant, put it in `base` via `pattern.raw({...})` rather than
re-`.raw()`ing the same call in each variant:

```ts
const fallbackStyles = cva({
  base: center.raw({
    inset: 0,
    position: "absolute",
    transition: "opacity {durations.slowest} {easings.out}",
  }),
  variants: {
    visible: {
      false: { opacity: 0 },
      true: { opacity: 1 },
    },
  },
});
```

## Logical properties

Use logical properties throughout — `paddingInlineStart` instead of
`paddingLeft`, `insetBlockEnd` instead of `bottom`, `marginInline: "auto"`
instead of `marginLeft: "auto"`, `inlineSize` instead of `width`, etc.
Shorthands like `paddingBlock`, `paddingInline`, `marginBlock`, `inset`
are also fine.

Physical properties (`left`, `right`, `top`, `bottom`) are reserved for
the rare case where the orientation is intentionally physical (e.g. an
arrow that always points to the physical right). Document the reason
when you reach for a physical property.

## Shorthand

Prefer shorthand declarations: `border: "1px solid {colors.border}"`
over the three longhand properties, `transition: "opacity {durations.fast}
{easings.out}"` over three transition-* properties. The exception is
when you need different values per state (e.g. only `borderColor`
changes on hover) — then the longhand is fine.

## Numeric values

For spacing tokens, use bare numbers: `paddingBlock: 1.5`. Don't quote
them as strings.

For tokens that take string names (color, radii, easings, etc.), use the
string form: `color: "muted"`, `borderRadius: "lg"`.

For token interpolation inside string values (`color-mix`, `calc`,
multi-value shorthands), use `{path}` syntax: `"calc({spacing.8} - 2px)"`,
`"color-mix(in oklab, {colors.danger} 70%, {colors.background})"`.

## Conditions

Prefer Panda's built-in condition keys to writing raw selectors:

- `_hover`, `_focus`, `_focusVisible`, `_active`, `_disabled`, `_invalid`,
  `_loading`, `_starting`, `_open`, `_closed`, etc.
- These resolve to attribute-aware selectors. For example, `_loading`
  matches `:is([data-loading], [aria-busy=true])`, and `_disabled` matches
  `:is(:disabled, [data-disabled])`.

The domicile preset also defines `_activeEnabled` and `_hoverEnabled`
(active/hover but only when the element is also enabled), which is what
buttons use to avoid hover/active styles firing on a disabled control.

Use property-conditional shorthand:

```ts
backgroundColor: { base: "transparent", _hover: "card", _disabled: "card" }
```

Raw selectors (e.g. `&:has(...)`, `&[data-foo]`) are typed as
nested-block keys only:

```ts
{
  alignItems: "center",
  "&:has(input[data-invalid])": { borderColor: "danger" },
  "&[data-prefix-stack] [data-prefix-invalid]": { transform: "translateY(0)" },
}
```

Don't mix raw selectors into the property-conditional object — that's a
type error.

## data-* attributes as styling hooks

When a component needs to coordinate styling across multiple internal
elements based on state, use stable `data-*` attributes as the selector
target rather than relying on generated class names:

```tsx
<span data-prefix-stack="">
  <span data-prefix-decoration="">...</span>
  <span data-prefix-invalid="">...</span>
</span>
```

```ts
// In the wrapper cva:
"&:has(textarea[data-invalid]) [data-prefix-stack] [data-prefix-decoration]": {
  transform: "translateY(100%)",
},
```

## Animations and transitions

- Define all `@keyframes` in the package's Panda preset under
  `theme.extend.keyframes` (or rely on the keyframes defined in the domicile
  preset). Reference them by name from `css(...)` via
  `animationName: "pulse"`. **Never** define keyframes inline.
- Use the `transition` shorthand with `{durations.X} {easings.Y}` token
  interpolation: `transition: "opacity {durations.fast} {easings.default}"`.
- For base-ui Popup/Backdrop/Popover enter/exit animations, use the
  `&[data-starting-style]` and `&[data-ending-style]` selectors with
  `opacity` and `transform` transitions.
