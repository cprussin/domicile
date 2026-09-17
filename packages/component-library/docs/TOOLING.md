# Tooling

What we use, and the workflow rules that go with it.

## Stack

- **Component primitives** — [`@base-ui/react`](https://base-ui.com). Wrap
  base-ui wherever a primitive exists; do not re-implement behavior (focus
  management, keyboard nav, portals, validation, etc.) that base-ui already
  gives you.
- **Icons** — `@phosphor-icons/react/dist/ssr/<IconName>` — one icon, one
  import. **Never** import from the `@phosphor-icons/react` barrel; it pulls
  in every icon and breaks SSR/RSC. **Always import the `*Icon`-suffixed
  name** (e.g. `XIcon`, `WarningCircleIcon`, `CaretRightIcon`) — the
  unsuffixed names (`X`, `WarningCircle`, `CaretRight`) are deprecated
  backward-compat aliases that will be removed in a future Phosphor major.
  TypeScript won't flag the deprecated form; it's on you to use the suffixed
  one:

  ```ts
  // correct
  import { XIcon } from "@phosphor-icons/react/dist/ssr/X";

  // wrong — deprecated alias
  import { X } from "@phosphor-icons/react/dist/ssr/X";

  // wrong — barrel import
  import { XIcon } from "@phosphor-icons/react";
  ```
- **Styling** — [Panda CSS](https://panda-css.com). Panda runs as a PostCSS
  plugin, extracting atomic CSS at build time. There is no
  `postcss.config.cjs`: each bundler is handed the plugin directly —
  `.storybook/main.ts` merges it into Storybook's vite config through
  `viteFinal`, and an app does the same in its own `vite.config.ts`. See
  [STYLING.md](./STYLING.md).
- **Tests** — `bun:test` + `@testing-library/react`. See
  [TESTING.md](./TESTING.md).
- **Storybooks** — `@storybook/react-vite`. See
  [STORYBOOKS.md](./STORYBOOKS.md).

## Dependencies

Do not introduce new runtime dependencies without confirming with the
developer that this is the intent.

## Codegen

Run `bun run prepare` (the Panda codegen) after any change to
`pandacss-preset.ts` or anything else that affects the generated
`styled-system/` files (new spacing tokens, new color tokens, new recipes,
etc.). The turbo `prepare` task runs it automatically as a dependency of
`build` / `test:types` / `test:unit`, but you'll want to run it manually
when iterating locally on the preset.

## Required checks before merging

Linting and type checks must pass. `./scripts/check.sh` from the repo root is
the whole answer and runs both languages; `./scripts/check.sh typescript` is
this side of it alone, and that is `biome check .` plus `bun run turbo test`.
See [/docs/guidelines/WORKSPACE.md](/docs/guidelines/WORKSPACE.md).
