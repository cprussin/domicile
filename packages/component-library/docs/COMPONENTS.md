# Component implementation

## Props typing — use `ExtendProps`

Type a wrapper's props with `ExtendProps<T, U>` from `../extend-props`:

```ts
import type { ExtendProps } from "../extend-props";

type Props = ExtendProps<typeof BaseInput, {
  clearable?: boolean | undefined;
  prefixIcon?: ReactNode | undefined;
}>;
```

- It equals `U & Omit<ComponentProps<T>, "className" | "style" | keyof U>`.
- It passes through the wrapped component's props, drops `className` and
  `style`, and lets `U` override conflicting keys.
- A polymorphic component declares a union of `ExtendProps` types. See
  `Button.tsx`, which renders `<button>` or `<a>`.

## `className` is private

- Components do not take a `className` prop.
- Expose variants, sizes and states as explicit props: union literals or
  booleans.

## Use base-ui where possible

- Accept and spread all props of the wrapped base-ui component. Don't
  restrict them.
- Leave focus, keyboard navigation, validation, positioning and open/close
  transitions to base-ui.
- Use base-ui's `render` prop to swap in our components. Example:
  `ModalDialog.Close` renders a `<Button>`.

## Refs

Use `useStableRef` from `../_control/useStableRef`:

```ts
const [elementRef, setElementRef] = useStableRef<HTMLInputElement>();
// ... ref: setElementRef
```

- It returns `[RefObject, RefCallback]`. The callback keeps the same
  identity across renders, so the child does not re-attach.
- `current` is `null` after unmount. Check it before use.

## Variants and sizes

Use union literal types and pass them to a `cva` recipe:

```ts
export const VARIANTS = ["primary", "outline", "ghost", ...] as const;
export type Variant = (typeof VARIANTS)[number];

type Props = ... & { variant?: Variant | undefined };

className={cx(control({ size }), styles({ variant, ... }))}
```

Export the `VARIANTS` array. Stories use it as the control's `options`.

## Mutually exclusive props

Use a discriminated union so TypeScript rejects invalid combinations:

```ts
type Props = (
  | { suffixButtons?: undefined; suffixIcon?: ReactNode | undefined }
  | { suffixButtons: ReactNode; suffixIcon?: undefined }
);
```

## Composing components

Attach sub-parts with `Object.assign`, so callers write `ModalDialog.Close`:

```tsx
const ModalDialogComponent = (...) => ...;
const Close = BaseDialog.Close;
const CloseButton = (props) => <Close render={<Button {...props} />} />;

export const ModalDialog = Object.assign(ModalDialogComponent, {
  Close,
  CloseButton,
});
```

When wrapping a compound base-ui primitive, flatten the API: take props like
`title`, `footer` and `trigger` and render the parts internally. Still expose
the parts for callers that need them.

## Imperative handles

Re-export base-ui's `createHandle()` from the wrapper, so callers import from
one place:

```ts
export const { createHandle } = BaseDialog;
```

## React + base-ui timing pitfall

Effects run bottom-up, and `useEffect` runs after all layout effects. So a
parent's `useEffect` runs after a child's `useLayoutEffect`. If the parent
must set something up first (for example, a Storybook decorator that patches
a global), either:

1. **Install during render** with a lazy `useState(installX)`.
2. **Gate the child** behind a flag that the parent's `useLayoutEffect` sets.
   The empty first render never paints, because layout effects run before
   paint.

`Avatar/slowImageDecorator.tsx` shows option 2.
