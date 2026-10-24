# minimal-shell

The smallest working Domicile shell: every window full-screen, newest on top.
It is the worked example from [WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md).

- `src/index.ts` exports `Shell`, which mounts an `<app>` for each window in
  the desktop's `windows`. That file is the whole shell.
- For fuller shells, see
  [`@domicile-desktop/shell-simple`](/packages/shell-simple/README.md) (drag,
  resize, terminal shortcut) and
  [`@domicile-desktop/manganese`](/packages/shell-manganese/README.md) (the
  bundled chrome).

## Build and run

```sh
bun install
bun run build
nix run github:cprussin/domicile/782471d9d4b45947bee1fbf09f7249f11bdac33d -- ./.vite/renderer/main_window/shell.js
```

- The build emits one file, `.vite/renderer/main_window/shell.js`. Domicile
  serves its directory, then starts the compositor and the engine on it.
- The SDK version, `0.0.0-alpha-782471d9d4b4`, is published from that commit,
  a `stable` release. Run the shell on the commit its SDK names. To move
  forward, change both to a newer `stable` commit.

To load a rebuilt shell, run this in a terminal inside the desktop:

```sh
domicile load-shell ./.vite/renderer/main_window/shell.js
```

## Why it lives outside `packages/`

This shell tests that the SDK works as a published package. Inside the bun
workspace, the SDK resolves to TypeScript source and `catalog:` /
`workspace:*` work, so a broken package would still build there. This
directory depends on the SDK by version, like a shell in another repo.

[`/scripts/test-out-of-tree-shell.sh`](/scripts/test-out-of-tree-shell.sh)
packs the SDK, copies this directory out of the repo, installs the tarball and
builds. It runs in `./scripts/check.sh shell`. It catches:

- an `exports` entry pointing at a file `files` doesn't ship;
- a type that won't emit to `.d.ts`;
- a `catalog:` left in a published manifest.

Two more checks cover this manifest as written:

- [`/packages/ci/tests/test-the-example-shell-names-one-release.sh`](/packages/ci/tests/test-the-example-shell-names-one-release.sh)
  (`./scripts/check.sh shell`): the SDK is an exact published version, and the
  commands above name its commit and the built file.
- [`/.github/scripts/example-shell-from-npm.sh`](/.github/scripts/example-shell-from-npm.sh)
  (`example-shell.yml`): installs from npm, type-checks and builds a copy
  outside the repo, and checks the commit is on `stable`.
