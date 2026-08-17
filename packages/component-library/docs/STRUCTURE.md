# Structure

## Component directory layout

Every new component lives in a directory under `src/` named for the component,
with three files:

- `./src/ComponentName/ComponentName.tsx` — the component entry point.
- `./src/ComponentName/ComponentName.stories.tsx` — storybook stories.
- `./src/ComponentName/ComponentName.test.tsx` — unit tests.

There are no `.module.scss`, `.css`, or other style files — styles live in
the `.tsx` next to the component that uses them.

## File organization within a component file

See `/docs/guidelines/FILES.md` for the general top-to-bottom reading rule. For
component files specifically, the typical order is:

1. Imports (third-party first, then local).
2. Re-exports (e.g. `export { SIZES, type Size } from "../control-sizes";`).
3. Module-level constants that are simple values referenced by the component
   (e.g. animation `Keyframe[]` arrays, duration constants).
4. The `type Props` declaration.
5. The component itself (`export const Foo = (...) => ...`).
6. `cva` recipes used by the component.
7. Helper functions used by the component.

See `Button.tsx` for the canonical layout: `tinted` / `ghost` (referenced
inside the `styles` cva at module-load time) sit above `styles`, while
runtime helpers sit at the file foot.
