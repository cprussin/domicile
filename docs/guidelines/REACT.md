# React & JSX

Applies to every React component, hook, and JSX file across the repo.

> **Status.** The chrome in `apps/shell` is not yet a React app and
> `@domicile/component-library` does not exist yet. This doc is in force from
> the first component: it is the contract the shell's UI build-out is expected
> to meet, not a description of code that is already here. References to the
> component library below describe what that package must provide when it
> lands; if you are the one creating it, these rules are its spec.

This doc covers the cross-cutting React rules. Styling (Panda tokens, `data-*`
hooks) is in [/docs/guidelines/STYLING.md](/docs/guidelines/STYLING.md); the
full Phosphor icon rules are in
[/docs/guidelines/ICONS.md](/docs/guidelines/ICONS.md).

## No `className` or `style` prop

Components MUST NOT expose `className` or `style` as props. Expose explicit,
named props for every supported variation instead. A component owns its
styling entirely; callers cannot leak arbitrary classes or inline styles into
it, and variant/state combinations the design does not support are simply not
reachable.

Surface component variants (size, tone, density) and runtime state (selected,
disabled, loading) to CSS via `data-*` attributes the component sets on its
own markup — not a class or style passthrough. Style them with attribute
selectors / Panda conditions; see
[data attributes as styling hooks](/docs/guidelines/STYLING.md#data--attributes-as-styling-hooks).

`@domicile/component-library` must enforce this mechanically: an
`ExtendProps<T, U>` helper that strips `className` and `style` from the wrapped
element's props so they can't be re-exposed by accident.

## Phosphor icon imports

Import icons from `@phosphor-icons/react/dist/ssr/<IconName>`, one icon per
import statement, using the `*Icon`-suffixed name. The barrel import
(`@phosphor-icons/react`) pulls in every icon and breaks SSR / React Server
Components.

```ts
// correct
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";

// wrong — barrel import
import { CaretRightIcon, XIcon } from "@phosphor-icons/react";

// wrong — deprecated unsuffixed alias
import { X } from "@phosphor-icons/react/dist/ssr/X";
```

The full rules — including why the unsuffixed names are deprecated — are in
[/docs/guidelines/ICONS.md](/docs/guidelines/ICONS.md).

## Wrapping `@base-ui/react`

When a component wraps a `@base-ui/react` primitive, defer all interaction
logic — focus management, keyboard navigation, portals, positioning,
validation, open/closed transitions — to base-ui rather than re-implementing
it. Check https://base-ui.com/react/components first: if a primitive exists,
wrap it; the wrapper's job is styling and an ergonomic API, and it should
accept and spread every prop the underlying component takes. Build from
scratch only for components base-ui does not cover.

The detailed wrapping rules for `@domicile/component-library` — props via
`ExtendProps`, re-exporting `createHandle`, composing compound parts — belong
in that package's own `docs/` once it exists.

## Errors and error boundaries

React's error-boundary contract governs how thrown errors propagate from
rendering paths and event handlers. The [code offensively](/docs/guidelines/ERRORS.md)
rule applies here too — do not wrap event handlers in `try`/`catch` just to
silence a thrown error.

- **Rendering paths** (component bodies, render-phase code in `useMemo`,
  selectors, etc.) — thrown errors are caught by the nearest error boundary
  and surface a real failure state. Let them propagate. Do not wrap a
  render-phase expression in `try`/`catch` to substitute a fallback value;
  that hides the failure from the boundary.
- **Event handlers / effects** — thrown errors here are **not** caught by the
  boundary by default; React logs them and the app continues. That is not a
  license to swallow: let the error bubble so the runtime surfaces it, or
  convert the failure to state the UI renders (`setError(err)` and show an
  error region). Wrapping handlers in `try`/`catch` purely to prevent the log
  is the React-shaped form of catch-and-swallow.
- **Async work kicked off from a handler** — apply the
  [promise error handling](/docs/guidelines/ERRORS.md#promise-error-handling) rule.
  Attach a `.catch` that logs (and, if relevant, surfaces the failure as UI
  state); never `void promise()`.

If a component genuinely needs to render a fallback when a child throws, use
an error boundary — that is the contract. Don't reach for `try`/`catch`
inside the parent.

## Never suppress `useExhaustiveDependencies`

`// biome-ignore lint/correctness/useExhaustiveDependencies` is forbidden.
The rule encodes a real invariant — the dep array must exactly mirror the
reactive values the hook reads — and once the React Compiler is enabled,
lying to it via a suppression *will* miscompile your hook (the compiler
optimises around the stated deps; a "phantom" dep doesn't make the body
re-read the value, and a missing dep won't trip a refresh).

When the rule complains, restructure the hook so the dep array tells the
truth:

- "Re-run on demand" counters (`refreshTrigger`, `version`) → replace the
  counter with a `useCallback` that owns the work plus a `useRef`-stored
  canceler. Consumers call the callback directly, which cancels the in-flight
  run and starts a fresh one; the `useEffect` that runs the work on mount
  lists the callback itself, so its dep array is exactly the inputs that
  change behavior.
- "Force recompute when ref mutates" version bumps → hold the value in
  `useState` instead of a ref-plus-counter, and pass the state into the
  memo's dep array. Splitting the read path (state for observable changes,
  ref for non-reactive scratch) keeps the compiler honest.

If you cannot see how to restructure, stop and ask. Suppression is not an
option, and "the existing code did it" is not justification — prior changes
that landed with this ignore are bugs to clean up, not templates.
