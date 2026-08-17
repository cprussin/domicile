# Component implementation

## Props typing — use `ExtendProps`

Components that wrap a base-ui or HTML element use `ExtendProps<T, U>`
from `../extend-props` rather than manually
`Omit<ComponentProps<T>, "className">`:

```ts
import type { ExtendProps } from "../extend-props";

type Props = ExtendProps<typeof BaseInput, {
  clearable?: boolean | undefined;
  prefixIcon?: ReactNode | undefined;
  // ...
}>;
```

`ExtendProps<T, U>` is
`U & Omit<ComponentProps<T>, "className" | "style" | keyof U>` — it
spreads the base component's props while:

- Stripping `className` and `style` (which the wrapper owns).
- Letting your own prop declarations override conflicting keys from the
  base.

Polymorphic components (e.g. `Button` rendering as either `<button>` or
`<a>`) declare a union of `ExtendProps` instances. See `Button.tsx`.

## `className` is private

**Do not expose a `className` prop on a component.** Variant/size/state
choices are explicit props with union literal types or booleans. The
component owns its className entirely; callers cannot leak arbitrary
styles into it.

## Use base-ui where possible

When a component mostly just wraps a `@base-ui/react` component, ensure
the wrapper accepts and spreads all of the underlying base-ui
component's props (this happens naturally via `ExtendProps`). The
wrapper's job is styling + ergonomic API; it should not artificially
restrict what callers can pass through.

For interaction logic — focus management, keyboard nav, validation,
positioning, transitions between open/closed states — defer to base-ui.
Use its `render` prop to swap in custom presentational components (see
how `ModalDialog.Close` uses `<Button>` as its render element).

## Refs

When you need a ref to the wrapped element, use the shared
`useStableRef` hook from `../_control/useStableRef`:

```ts
import { useStableRef } from "../_control/useStableRef";

const [elementRef, setElementRef] = useStableRef<HTMLInputElement>();

// ... ref: setElementRef
```

`useStableRef` returns a `[RefObject, RefCallback]` pair where the
callback identity is stable across renders, so passing it to a child's
`ref=` prop won't cause the child to re-attach. The underlying ref
object types as `RefObject<E | null>` because React's ref API passes
`null` on unmount; check `current !== null` before dereferencing.

## Variants and sizes

Per-prop choices use union literal types and are passed to a `cva`
recipe:

```ts
export const VARIANTS = ["primary", "outline", "ghost", ...] as const;
export type Variant = (typeof VARIANTS)[number];

type Props = ... & {
  variant?: Variant | undefined;
};

// In the component:
className={cx(control({ size }), styles({ variant, ... }))}
```

Exporting the `VARIANTS` array (not just the type) is required —
storybook `argTypes` uses it as the `options` for the control.

## Mutually exclusive props

For mutually exclusive props (e.g. "either a string label or a render
ReactNode"), use a discriminated union, not a runtime check:

```ts
type Props = (
  | { suffixButtons?: undefined; suffixIcon?: ReactNode | undefined }
  | { suffixButtons: ReactNode; suffixIcon?: undefined }
);
```

This lets TypeScript prevent the invalid combination at the call site.

## Composing components

For components made of multiple parts (Dialog, etc.), attach the parts
to the top-level component via `Object.assign` so callers see
`ModalDialog.Close`, `ModalDialog.CloseButton`, etc.:

```tsx
const ModalDialogComponent = (...) => ...;
const Close = BaseDialog.Close;
const CloseButton = (props) => <Close render={<Button {...props} />} />;

export const ModalDialog = Object.assign(ModalDialogComponent, {
  Close,
  CloseButton,
});
```

For top-level components that wrap a full compound primitive (like
`ModalDialog` wrapping base-ui's Dialog parts), prefer to flatten the
API: expose props like `title`, `footer`, `trigger` that internally
render the appropriate parts, rather than forcing callers to assemble
the parts themselves. The parts can still be exposed (as in
`ModalDialog.Close`) for escape hatches.

## Imperative handles

When base-ui exposes an imperative `createHandle()` API (Dialog,
Popover, etc.), re-export it from your wrapper so callers don't need to
import from two places:

```ts
export const { createHandle } = BaseDialog;
```

## React + base-ui timing pitfall

`useEffect` runs as a passive effect AFTER all layout effects (including
those in child components — effects fire bottom-up). If a parent wrapper
(e.g. a Storybook decorator that patches a global) needs to install
something BEFORE a child's `useLayoutEffect` / `useIsoLayoutEffect`
fires, you have two options:

1. **Install during render** via `useState` lazy init —
   `useState(installX)`. The initializer runs once during the parent's
   render, before any child renders or layout effects.
2. **Gate the child render** behind a state flag the parent's
   `useLayoutEffect` flips. The child doesn't mount until the second
   render, which is triggered by `setReady(true)` inside the effect. The
   empty first render is invisible because layout effects flush
   synchronously before paint.

See `Avatar/slowImageDecorator.tsx` for the canonical (option 2) pattern.
