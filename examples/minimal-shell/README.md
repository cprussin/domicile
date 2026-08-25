# minimal-shell

The worked example from [/docs/WRITING-A-SHELL.md](/docs/WRITING-A-SHELL.md): a
Domicile shell with no dependency on this repository.

Every window full-screen, newest on top. That is the least a shell can do and
still be one — a real shell differs from it only in where it puts the elements
and what it draws around them.

## Why it is here and not in `packages/`

`packages/` is the bun workspace. Inside it `@domicile/chrome-sdk` resolves to a
symlinked directory of TypeScript source, `catalog:` and `workspace:*` mean
something, and every package shares one `node_modules` — so a shell in there
builds whether or not the SDK is consumable anywhere else. This one is outside
the workspace and depends on the SDK by published version, exactly as a shell in
someone else's repository would.

[`/scripts/test-out-of-tree-shell.sh`](/scripts/test-out-of-tree-shell.sh)
packs the SDK, copies this directory somewhere outside the repo, installs the
tarballs, and builds it there. It runs in `./scripts/check.sh shell`.

So this is not decoration: it is the only thing standing between the SDK and an
`exports` entry pointing at a file `files` does not ship, a type that will not
emit to `.d.ts`, or a `catalog:` that survived into a published manifest.

## Layout

| File | What |
|---|---|
| `domicile.shell.json` | The manifest. `entry` is what Domicile runs — not `package.json`'s `main`. |
| `src/main.ts` | The Electron main process: open the window, die with a reason. Everything a page cannot do for itself, and only that. |
| `src/preload.ts` | Holds the compositor socket and hands the page its messages. The socket lives here rather than in the main process so frames do not cross Electron's IPC. |
| `src/renderer.ts` | The page: mount a `<domicile-app>` per announced app. The whole of this shell's behaviour. |

## Building and running it

```sh
bun install
bun run build
```

Then point a Domicile config at it and start the compositor:

```toml
[shell]
package = "/path/to/examples/minimal-shell"
```

```sh
domicile-compositor --present
```

A path reference needs no install step and may be called anything; installing it
by name is described in the guide.
