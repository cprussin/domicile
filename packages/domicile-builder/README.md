# @domicile-desktop/builder

Builds a shell module from a user's TypeScript or JavaScript file, so a desktop
can be configured without a project or build step. See
[COMPOSABLE-SHELLS.md](../../docs/architecture/COMPOSABLE-SHELLS.md).

## Usage

```sh
domicile-builder (--entry <file> | --package <spec> | --evaluate <config>) \
  --domicile <install> --cache <dir>
```

- **`--entry`**: build a local file, such as `~/.config/domicile/domicile.tsx`.
- **`--package`**: install an npm or `github:` package into its own project
  under the cache. Use the module its `package.json` names in
  `"domicile": { "shell": "…" }`, or build its entry.
- **`--evaluate`**: run a config module and write every export except `Shell`
  as the compositor's JSON config.
- **`--domicile`**: Domicile's install, laid out like this repo:
  `packages/shell-manganese` with its `node_modules` and `styled-system`.

## Output

Each step is one JSON line on stdout. Other stdout lines are tool logs.

```json
{"step":"resolving"}
{"packages":["date-fns"],"step":"installing"}
{"step":"bundling"}
{"cached":false,"module":"shell.js","root":"<cache>/<key>","step":"built"}
{"cached":false,"config":"<cache>/configs/<key>.json","step":"evaluated"}
```

On failure it prints `{"step":"failed","why":"…"}` and exits non-zero.

## Build steps

| Step | Module |
|---|---|
| Read every local file and package the entry imports | `src/graph.ts` |
| Find the project (nearest `package.json` above the entry, else the entry's directory). `bun add --ignore-scripts` imports it doesn't list | `src/project.ts`, `src/main.ts` |
| Key the cache on the files, lockfile and Domicile install. A cache hit takes under a second | `src/project.ts` |
| Bundle with vite, CSS included. `@domicile-desktop/*` and React resolve from Domicile's install. Panda uses manganese's config | `src/bundle.ts` |

## Test

```sh
bun run test:unit    # src/bundle.test.ts builds against this checkout
bun run test:types
```
