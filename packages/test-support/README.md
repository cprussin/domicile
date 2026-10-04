# @domicile-desktop/test-support

Shared bun test setup for packages whose tests need a DOM.

## Exports

- **`@domicile-desktop/test-support/preload`**: the setup module. It:
  - registers happy-dom's globals (`document`, `window`);
  - adds jest-dom matchers (`toBeInTheDocument`, …) to bun's `expect`;
  - runs Testing Library's `cleanup` after each test;
  - prints DOM nodes as markup in failed matchers (`src/node-inspection.ts`);
  - registers `<app>` as a known element (`src/app-element.ts`);
  - leaves frames at their `src` without fetching, since only the engine serves
    `domicile://` pages.
- **`matchers.d.ts`** (the root `types` entry): types for the jest-dom matchers
  on `bun:test`'s `expect`.

## Usage

In the consuming package's `bunfig.toml`:

```toml
[test]
preload = ["@domicile-desktop/test-support/preload"]
```

In its `tsconfig.json`:

```json
{ "compilerOptions": { "types": ["bun", "@domicile-desktop/test-support"] } }
```

## Test

```sh
bun run --filter @domicile-desktop/test-support test:unit
bun run --filter @domicile-desktop/test-support test:types
```

Consumers' test suites also exercise the preload.
