# @domicile/builder

Builds a shell module out of a user's own TypeScript or JavaScript entry, so a
desktop can be configured with a file rather than a project and a build step.
See [COMPOSABLE-SHELLS.md](../../docs/architecture/COMPOSABLE-SHELLS.md).

```sh
domicile-builder --entry ~/.config/domicile/domicile.tsx \
  --domicile <Domicile's install> --cache ~/.cache/domicile/shells
```

Each step is one JSON line on stdout; anything else there is the tools' own
log:

```json
{"step":"resolving"}
{"packages":["date-fns"],"step":"installing"}
{"step":"bundling"}
{"cached":false,"module":"shell.js","root":"<cache>/<key>","step":"built"}
```

`{"step":"failed","why":"…"}` and a non-zero exit on a failure.

## What a build does

| Step | Module |
|---|---|
| Read every local file the entry reaches, and every package it imports | `src/graph.ts` |
| Find the project — the nearest `package.json` above the entry, or the entry's own directory — and `bun add --ignore-scripts` what it imports and does not list. `package.json` and `bun.lock` are written there | `src/project.ts`, `src/main.ts` |
| Key the build on those files, the lockfile and the install it is built against; a hit is done in well under a second | `src/project.ts` |
| Bundle with vite, as `shellBuild` does: `Shell` kept, CSS inside. `@domicile/*` and React resolve from Domicile's install, as manganese resolves them; Panda runs over manganese's own config | `src/bundle.ts` |

`--domicile` is laid out as this repository is: `packages/shell-manganese`
with its `node_modules` and `styled-system`.

## Test

```sh
bun run test:unit    # src/bundle.test.ts builds against this checkout
bun run test:types
```
