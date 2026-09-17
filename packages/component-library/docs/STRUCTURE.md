# Structure

## Component directory layout

Every new component lives in a directory under `src/` named for the component,
with at least these three files:

- `./src/ComponentName/ComponentName.tsx` — the component entry point.
- `./src/ComponentName/ComponentName.stories.tsx` — storybook stories.
- `./src/ComponentName/ComponentName.test.tsx` — unit tests.

Anything else the component needs goes beside them in its own focused file
rather than into the entry point or a `utils.ts` — `Avatar/initials.ts` and
`Avatar/gradient.ts`, `Screen/display-source.ts`, `ThemeSwitch/theme-core.ts`.
That is [/docs/guidelines/FILES.md](/docs/guidelines/FILES.md)'s rule about
grab-bag names, applied inside a component directory. A second component that
only ever appears with the first lives there too (`Screen/DisplayProvider.tsx`,
`ThemeSwitch/ThemeProvider.tsx`), with its own test beside it.

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
