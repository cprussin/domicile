# `@domicile-desktop/component-library` docs

Index of this package's guidelines. It adds to the
[root docs index](/AGENTS.md), which defines the `ALWAYS`, `IF TOUCHED` and
`REFERENCE` levels. Load the root `ALWAYS` docs first.

If your change touches code that breaks a guideline, fix that first.

## ALWAYS

| Doc | Covers |
|---|---|
| [STRUCTURE.md](./STRUCTURE.md) | Component directory layout and file order. |
| [STYLING.md](./STYLING.md) | The `control` recipe, `wrapperBase`, and `data-*` styling hooks. Read [/docs/guidelines/STYLING.md](/docs/guidelines/STYLING.md) first. |
| [TESTING.md](./TESTING.md) | Test coverage and selectors. |

## IF TOUCHED

| Doc | Load when |
|---|---|
| [COMPONENTS.md](./COMPONENTS.md) | You write or change a component. |
| [STORYBOOKS.md](./STORYBOOKS.md) | You write or change a story. |

## REFERENCE

| Doc | Covers |
|---|---|
| [TOOLING.md](./TOOLING.md) | Stack, dependencies, codegen, required checks. |

## Common traps

- **Panda extractor:** Panda only generates CSS for literal values. A `cva`
  with a `base` imported from another file, or `compoundVariants` built at
  runtime, gets class names with no CSS. See
  [/docs/guidelines/STYLING.md](/docs/guidelines/STYLING.md#pandas-static-extractor--the-1-source-of-bugs)
  and [STYLING.md](./STYLING.md#shared-base-styles-for-input--textarea).
- **Story args:** set omitted content props to `undefined` in `args`. See
  [STORYBOOKS.md](./STORYBOOKS.md#story-args--be-explicit).
- **Effect timing:** a parent's `useEffect` runs after its children's layout
  effects. See [COMPONENTS.md](./COMPONENTS.md#react--base-ui-timing-pitfall).
