# minimal-shell

The worked example from [/docs/WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md): a
Domicile shell with no dependency on this repository.

Every window full-screen, newest on top. That is the least a shell can do and
still be one — a real shell differs from it only in where it puts the elements
and what it draws around them.

It is the floor, and the two shells shipped in `packages/` are what gets built
on it: [`@domicile/shell-simple`](/packages/shell-simple/README.md) adds drag,
resize and a terminal shortcut without adding any widgets, and
[`@domicile/shell-manganese`](/packages/shell-manganese/README.md) is the
bundled reference chrome. Neither can stand in for this one, for the reason
below.

## Why it is here and not in `packages/`

`packages/` is the bun workspace. Inside it `@domicile/chrome-sdk` resolves to a
symlinked directory of TypeScript source, `catalog:` and `workspace:*` mean
something, and every package shares one `node_modules` — so a shell in there
builds whether or not the SDK is consumable anywhere else. This one is outside
the workspace and depends on the SDK by published version, exactly as a shell in
someone else's repository would.

[`/scripts/test-out-of-tree-shell.sh`](/scripts/test-out-of-tree-shell.sh)
packs the SDK, copies this directory somewhere outside the repo, installs the
tarball, and builds it there. It runs in `./scripts/check.sh shell`.

So this is not decoration: it is the only thing standing between the SDK and an
`exports` entry pointing at a file `files` does not ship, a type that will not
emit to `.d.ts`, or a `catalog:` that survived into a published manifest.

## Layout

| File | What |
|---|---|
| `index.html` | The document, which loads the page and does nothing else. |
| `src/renderer.ts` | The page: mount a `<domicile-app>` per announced app. The whole of this shell's behaviour. |

Two files, and that is the point. A shell used to be four bundles and a
launcher — an Electron main process, a preload holding the compositor socket, a
launcher starting the compositor underneath, and the page. Under the fork the
engine is the display compositor and Domicile starts it, so all a shell is now
is a built web page.

## Building and running it

```sh
bun install
bun run build
```

emits the page to `.vite/renderer/main_window/`. Point Domicile at it:

```sh
nix run github:cprussin/domicile -- ./.vite/renderer/main_window
```

which serves that directory, starts the engine on it and the compositor
underneath. There is nothing to install and no `bin/` entry: which desktop you
get is which page Domicile was pointed at.
