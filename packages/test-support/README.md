# @domicile/test-support

Shared bun test setup for packages whose tests need a DOM — the chrome SDK's
custom elements and the shell's controller both mount into one. Every such
package needs the same setup before its tests run; this package owns it in one
place so it doesn't drift across the monorepo.

- `@domicile/test-support/preload` — the one setup module: registers
  happy-dom's globals (giving the test a `document`/`window` to render into)
  *before* extending bun's `expect` with jest-dom matchers
  (`toBeInTheDocument`, …) and installing Testing Library's `cleanup` as an
  `afterEach`, so a component test's tree never leaks into the next one. They
  always go together, so they ship as a single preload.
- `matchers.d.ts` (the package's root `types` entry) — the ambient module
  augmentation that teaches `bun:test`'s `expect` about those matchers, so the
  type checker knows about them too.

## Usage

Preload the setup module from the consuming package's `bunfig.toml`:

```toml
[test]
preload = ["@domicile/test-support/preload"]
```

and pull the matcher types into that package's `tsconfig.json`:

```json
{ "compilerOptions": { "types": ["bun", "@domicile/test-support"] } }
```

## Test

`bun run --filter @domicile/test-support test:types`. There are no unit tests —
the package is exercised transitively by every consumer's suite.
