# Workspace

Tools, layout, dependencies, and the required-checks workflow for this repo.

Domicile is a mixed-language repo: a Rust cargo workspace for the compositor
and host, and a TypeScript bun workspace for the chrome. This doc covers the
TypeScript side; the Rust side is in
[/docs/guidelines/RUST.md](/docs/guidelines/RUST.md). Nix pins both toolchains
— nothing needs to be installed globally.

## Tools

- `bun` is our package manager & runtime when needed
- `turbo` is our monorepo task orchestrator
- `biome` is our linter / formatter

## Layout

Every bun workspace in this repo lives in `/packages`, whether it is a library
(`chrome-sdk`, `component-library`, `test-support`, `e2e-harness`,
`electron-chrome-host`) or a shell — a runnable chrome package, named `shell-*`
(`shell-manganese`, `shell-simple`). A shell is not an "app" in its own
directory because it is not the thing that runs: the compositor is, and a shell
is the chrome package its config points at.

The `shell-` prefix is a directory convention, not part of a shell's identity:
`packages/` is shared with the cargo crates, and the prefix is what keeps the
shells together in one tree. A shell's own name is what its
`domicile.shell.json` says — `simple`, `manganese` — which is the name
`ShellRef::Name` looks up under `$XDG_DATA_HOME/domicile/shells` and the
system data directories. A checkout is not one of those, and `packages/` is not
a shells directory: point a config at a shell in this repo by path
(`package = "./packages/shell-simple"`), or pass `--shell ./packages/shell-simple`
— which is what `ShellRef::Path` is for. The end-to-end scripts pass
`--no-shell`, since each drives a compositor whose chrome is a stand-in of its
own.
See `packages/domicile-shell`.

Neither in-tree shell is privileged. Both are resolved and started by exactly
the machinery an out-of-tree shell goes through, and
[/docs/WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md) is the contract they
observe. `examples/minimal-shell` is that document's worked example: it sits
outside the bun workspace on purpose, and
`scripts/test-out-of-tree-shell.sh` builds it against the *published* SDK
tarballs somewhere outside the repo — the only check that can catch an
`exports` entry pointing at a file `files` does not ship, or a `catalog:` that
survived into a published manifest.

`@domicile/chrome-sdk` and `@domicile/electron-chrome-host` are published to
npm and are the only two packages here that are not `private`. They are the one place `useSortedKeys` is turned off — for
the whole manifest, in `biome.json`'s `overrides`, since the rule cannot be
scoped to one key. It is the `exports` map that needs it: export conditions are matched top to bottom, so `"types"` must come
before `"default"`, and sorting them alphabetically would make a lint rule
enforce a semantic bug in an artifact that leaves this repo. It works today even
sorted wrongly — TypeScript falls back to the sibling `.d.ts` — which is exactly
why it would not have been noticed until the emit layout changed. They emit
JavaScript and `.d.ts` into `dist/` via a `build` task, and their `exports` map
points there rather than at `src/` — a consumer outside this repo has no
TypeScript toolchain of ours to transpile our source with. Everything that
depends on them therefore depends on `^build` in `turbo.json`.

`/packages` is shared with the Rust side: the `domicile-*` crates live there
too, as members of the cargo workspace declared in the root `Cargo.toml`. One
package tree, two build systems — a package is a crate when it carries a
`Cargo.toml` and a bun workspace when it carries a `package.json`. Nothing in
this doc applies to the crates; see
[/docs/guidelines/RUST.md](/docs/guidelines/RUST.md).

See [ARCHITECTURE.md](/docs/architecture/ARCHITECTURE.md#crate-layout) for
the crates and what each one owns.

## Package READMEs

Every bun workspace in `/packages/` should have a `README.md`. (The crates
document themselves in rustdoc.)
It should orient a new contributor: what the package does, why it exists, its
dependencies, how to use it, and how to test it. Be comprehensive but
succinct — enough to get someone productive without re-reading the source.

Keep the README current as the package evolves. If a change affects the
public API, dependencies, usage, or what the package delivers, update the
README in the same change.

## Dependencies

### `catalog:` for all non-workspace deps

Every non-workspace dependency in any `package.json` MUST use `"catalog:"` as
its version, and every workspace dependency MUST use `"workspace:*"`. The
concrete version belongs in the root `package.json`'s `catalog` block, which
is the single source of truth for third-party versions across the monorepo.

```jsonc
// in a package
"dependencies": {
  "zod": "catalog:",
  "@domicile/chrome-sdk": "workspace:*"
}
```

To add a new third-party dependency:

1. Add the package and version to the root `package.json` `catalog` block,
   alphabetically sorted.
2. Reference it as `"catalog:"` in the consuming package's `package.json`.
3. Run `bun install` to refresh `bun.lock`.

Writing a concrete version (e.g. `"zod": "4.4.3"`) directly in a package is
wrong — any non-`workspace:` value other than `"catalog:"` is a defect. If
you find a direct version spec already in the repo, fix it.

### Minimum release age

`bunfig.toml` sets `minimumReleaseAge` so npm versions published in the last
seven days are refused. This is supply-chain hardening: it gives the community
time to flag a malicious release before it reaches an install. If you need a
version that is newer than that, say so explicitly in the PR rather than
lowering the floor.

### Latest versions

Use the latest stable version of any new dependency unless there is a
specific compatibility reason to pin older.

### Approval

Do not introduce a new third-party runtime dependency — npm crate or cargo
crate — without confirming with the developer that this is the intent.

## Required code checks

All TypeScript code should pass all checks run via
`bun run turbo test -- --ui stream`. This runs linting, formatting,
typechecking, and unit tests, and builds the shells' Vite bundles so a green
run means they actually build. If code is failing, first try
`bun run turbo fix -- --ui stream` to apply auto-fixes.

**Important:** the `bun run turbo` alias may resolve to a package-scoped turbo
invocation that only runs a subset of tasks. To run the full test suite across
all packages **and** root-level tasks (lint, dependency checks), use
`node_modules/.bin/turbo test` directly, or verify that the output shows all
tasks (including `//#test:lint` and `//#test:dependencies`). The root-level
`biome check` (run by `//#test:lint`) enforces formatting, import ordering, and
lint rules across the entire monorepo — always verify it passes before
considering tests complete.

The Rust side has its own required checks; see
[/docs/guidelines/RUST.md](/docs/guidelines/RUST.md). A change that touches
both languages must pass both.
