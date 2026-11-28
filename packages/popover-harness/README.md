# @domicile-desktop/popover-harness

Opens each bar popover crowded with rows on a small screen, in headless
Chromium through Playwright, and fails on any that runs off the screen.

- **The `Crowd` stories** draw a bar item with more rows than fit, on a
  1024x600 laptop screen at the top left of a desk that spans a 2560x1440
  monitor too, as one page for the desk does. Pick the item with the `crowd`
  control.
- **The harness** (`src/harness.ts`) presses each item's buttons in turn,
  then fails it when the panel runs off the laptop's screen, covers the bar,
  stands taller than 60% of the screen, its last row
  can't be scrolled into view, any part of it scrolls sideways, or a button
  is too narrow for its label. A crowd with a `drawer` also has that
  disclosure opened and, as soon as it has opened, shut, and fails when the
  drawer's height jumps rather than growing and shrinking, or the panel's
  height falls behind it. A crowd with a `toggle` is put in another state
  and back, such as paused, and fails when the panel or a section heading in it moves.
  A crowd with a `shrink` button has it pressed, such as Clear all, and fails
  when the panel's height jumps rather than shrinking, or it scrolls sideways
  as rows leave. A crowd with `grow` buttons has them pressed, the
  last growing the panel to a height that fits, such as a short page of
  details, and fails when any part of it shows a scrollbar on the way.
  Every crowd fails when its page reports an error, such as a
  ResizeObserver loop, which the engine logs as an error from the shell.
- **`viewport-units.test.ts`** fails any popover's content sized in `vh` or
  `vw`, which measure the whole desk, not the panel's screen.

## Adding a crowd

Write a scene in `src/scenes/` that draws a bar item under `Bar` with more
rows than fit, and add it to `CROWDS` in `src/crowds.ts` with the buttons that
open it, its last row's text, any `toggle` that must not move it, any
`shrink` button that takes rows out and any `grow` buttons that grow it to a
height that fits.

## Running

```sh
bun run --filter @domicile-desktop/popover-harness start:dev  # Storybook on :4002
bun run turbo test:shell --filter=@domicile-desktop/popover-harness
```

From `packages/popover-harness`, after `bun run build:storybook`:

```sh
bun src/harness.ts                 # every crowd
bun src/harness.ts notifications   # one
```

Needs Playwright's Chromium, as the motion harness does: `node_modules/.bin/playwright
install --with-deps chromium`, or another named by `--chromium <path>` (in the
check, `DOMICILE_POPOVER_CHROMIUM`). Without either the check skips. CI
installs it.
