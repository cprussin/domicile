# Structure

## Component directory layout

Each component has a directory under `src/` with at least:

- `src/ComponentName/ComponentName.tsx`: the component
- `src/ComponentName/ComponentName.stories.tsx`: stories
- `src/ComponentName/ComponentName.test.tsx`: tests

Other rules:

- Put helpers in their own named files in the same directory, not in a
  `utils.ts`. Examples: `Avatar/initials.ts`, `Screen/display-source.ts`. See
  [/docs/guidelines/FILES.md](/docs/guidelines/FILES.md).
- A component used only with another lives in that component's directory,
  with its own test. Examples: `Screen/DisplayProvider.tsx`,
  `ThemeSwitch/ThemeProvider.tsx`.
- No style files (`.css`, `.module.scss`). Styles live in the component's
  `.tsx`.

## File organization within a component file

Order a component file as follows (general rule in
[/docs/guidelines/FILES.md](/docs/guidelines/FILES.md)):

1. Imports: third-party, then local.
2. Re-exports, such as `export { SIZES, type Size } from "../control-sizes";`.
3. Simple constants the component uses, such as keyframes or durations.
4. `type Props`.
5. The component.
6. `cva` recipes.
7. Helper functions.

`Button.tsx` is the reference. Values a `cva` reads at module load (`tinted`,
`ghost`) go above that `cva`.
