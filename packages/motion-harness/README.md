# @domicile-desktop/motion-harness

Plays manganese's motions in Storybook and checks them in headless Chromium
through Playwright. See the motion pass in
[MOTION.md](/docs/architecture/MOTION.md).

- **The `Motion` stories** draw each motion's scene on a 960x540 screen with a
  button that plays it forward and back. `Slowed` plays every animation on the
  page at 0.1× for review; `AsShipped` at full speed. Pick the motion with the
  `motion` control.
- **The harness** (`src/harness.ts`) plays each motion from the built
  Storybook, forward and back, while Chromium traces its animations. It fails
  a motion when Blink kept any of its animations off the compositor, naming
  the property, the element and Blink's reasons, or when it played none.

## Adding a motion

Write a scene in `src/scenes/` that takes `played` (see `src/motion.ts`), and
add it to `MOTIONS` in `src/motions.ts`. The story and the harness pick it up.

## Running

```sh
bun run --filter @domicile-desktop/motion-harness start:dev  # Storybook on :4001
bun run turbo test:shell --filter=@domicile-desktop/motion-harness
```

From `packages/motion-harness`, after `bun run build:storybook`:

```sh
bun src/harness.ts                                # every motion
bun src/harness.ts overview-open                  # one
bun src/harness.ts --frames /tmp/frames overview-open
```

`--frames` also writes each motion's frames, slowed to 0.1× and at 2 device
pixels per CSS pixel, as numbered PNGs in a directory per motion.

- Needs Playwright's Chromium: `node_modules/.bin/playwright install --with-deps
  chromium`, or another named by `--chromium <path>` (in the check,
  `DOMICILE_MOTION_CHROMIUM`). Without either the check skips. CI installs it.
- Needs no GPU: it reads which thread ran each animation, not pixels.

## Test

```sh
bun run turbo test --filter=@domicile-desktop/motion-harness
```

`test:unit` covers the trace reader, the slowing and the player.
