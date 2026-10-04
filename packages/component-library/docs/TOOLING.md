# Tooling

## Stack

- **Components:** [`@base-ui/react`](https://base-ui.com). Wrap a base-ui
  primitive when one exists. Don't reimplement focus, keyboard navigation,
  portals or validation.
- **Icons:** import one icon per line from
  `@phosphor-icons/react/dist/ssr/<Name>`, using the `*Icon` name. Never
  import the `@phosphor-icons/react` barrel. See
  [/docs/guidelines/ICONS.md](/docs/guidelines/ICONS.md).

  ```ts
  import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
  ```
- **Styling:** [Panda CSS](https://panda-css.com), run as a PostCSS plugin.
  There is no `postcss.config.cjs`. Each Vite config adds the plugin
  directly: `.storybook/main.ts` in `viteFinal`, and each app in its own
  `vite.config.ts`. See [STYLING.md](./STYLING.md).
- **Tests:** `bun:test` and `@testing-library/react`. See
  [TESTING.md](./TESTING.md).
- **Stories:** `@storybook/react-vite`. See [STORYBOOKS.md](./STORYBOOKS.md).

## Dependencies

Ask the developer before adding a runtime dependency.

## Codegen

`bun run prepare` runs Panda codegen into `styled-system/`. Run it after
changing `pandacss-preset.ts` or anything else that changes tokens or
recipes. Turbo runs it before `build`, `test:types` and `test:unit`.

## Required checks before merging

Lint and type checks must pass.

- `./scripts/check.sh`: all checks, from the repo root.
- `./scripts/check.sh typescript`: `biome check .` and `bun run turbo test`.
- `bun run turbo test --filter @domicile-desktop/component-library`: this
  package's type check and unit tests.

See [/docs/guidelines/WORKSPACE.md](/docs/guidelines/WORKSPACE.md).
