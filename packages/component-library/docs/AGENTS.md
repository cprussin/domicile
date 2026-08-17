# `@domicile/component-library`

See [`../README.md`](../README.md) for the package overview and scripts. This
doc indexes the package-specific guidelines and is an addendum to the
[root docs index](/AGENTS.md). Authority levels (`ALWAYS`, `IF TOUCHED`,
`REFERENCE`) are defined there and the labels below follow that vocabulary;
these package docs augment the root docs and do not relist them — assume you
have already loaded the root ALWAYS docs.

This package owns the Panda preset (`src/pandacss-preset.ts`); the
cross-cutting styling rules in [/docs/guidelines/STYLING.md](/docs/guidelines/STYLING.md) reference
tokens defined here. When a change breaks a guideline, fix the violation
first, then make the change.

## ALWAYS (every change in this package)

| Doc | Covers |
|---|---|
| [STRUCTURE.md](./STRUCTURE.md) | Component directory layout (three files per component) and the file-organization rule inside a component file. |
| [STYLING.md](./STYLING.md) | Component-library styling conventions (the `control` recipe, the shared `wrapperBase`, the prefix-icon / resize `data-*` patterns). The cross-cutting Panda rules live in [/docs/guidelines/STYLING.md](/docs/guidelines/STYLING.md) — read that first. Its "Panda's static extractor" section catches a class of bug that's invisible until you ship. |
| [TESTING.md](./TESTING.md) | bun:test + RTL conventions, coverage expectations, selector preferences. |

## IF TOUCHED (load when your change touches the topic)

| Doc | Load when |
|---|---|
| [COMPONENTS.md](./COMPONENTS.md) | You author or modify a component. Props typing (`ExtendProps`), private `className`, refs (`useStableRef`), variants, mutually exclusive props, composing parts, imperative handles, the React/base-ui effect-timing pitfall. |
| [STORYBOOKS.md](./STORYBOOKS.md) | You add or modify a story. Required `meta` shape, explicit `args` for boolean and content props, variant matrices, story categories, Showcase rules. |

## REFERENCE

| Doc | Covers |
|---|---|
| [TOOLING.md](./TOOLING.md) | Stack (base-ui, Phosphor SSR, Panda, bun:test, Storybook), dependency policy, codegen, required checks. |

## Highlights / common traps

### Panda's static extractor (read this even if you're not styling)

Panda extracts CSS by reading literal values inside its runtime helpers
(`css`, `cva`, patterns). Values it can't statically resolve produce class
names with **no CSS rule attached**. Symptoms: the element gets the expected
class (`pbs_10`, `bd_muted`, …) but the property silently doesn't apply.

Most common causes:

- `cva({ base: someConstFromAnotherFile })` — cross-file const reference is
  opaque. Use `css(...)` + `cx(...)` composition instead.
- `compoundVariants: helper()` or `compoundVariants: SIZES.map(...)` —
  runtime construction is opaque. Inline the literal array.
- `flex(helperReturningStyles())` — same. Inline at the call site.

Full details in [STYLING.md](./STYLING.md#pandas-static-extractor--the-1-source-of-bugs).

### Storybook arg traps

Stories that omit a content prop (no `title`, no `footer`, no `prefixIcon`)
must set it to `undefined` explicitly. Storybook's text controls can
otherwise populate omitted props with empty strings, and values can persist
across story navigation. Both will defeat `prop === undefined` checks in the
component. See [STORYBOOKS.md](./STORYBOOKS.md#story-args--be-explicit).

### React effect timing

Parent `useEffect` runs after child layout effects. If a parent needs to set
up something before a child's `useLayoutEffect` fires, install during render
(`useState` lazy init) or gate the child render behind a state flag the
parent's layout effect flips. See
[COMPONENTS.md](./COMPONENTS.md#react--base-ui-timing-pitfall).
