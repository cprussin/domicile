# @domicile-desktop/shell-effects-example

A shell that builds the r/unixporn reference effects from
[MOTION.md](../../docs/architecture/MOTION.md#reference-effects) with the
SDK's shader effects alone. The guide is
[SHELL-SHADER-EFFECTS.md](../../docs/SHELL-SHADER-EFFECTS.md).

| Effect | File | Built with |
|---|---|---|
| Smoke | `src/smoke.ts` | fragment effect, a noise image, `outset: "screen"` |
| Cloth | `src/cloth.ts`, `src/cloth-simulation.ts` | grid mesh, points set each frame with `update` |
| Swarm | `src/swarm.ts` | instanced mesh, one fleck per instance |
| Liquid glass | `src/liquid-glass.ts` | `backdrop-filter` fragment effect with an outset |
| Cube | `src/cube.ts` | CSS 3D transforms, a `cube-face` effect for the shading |

`src/index.ts` is the shell: four workspaces on a cube, a liquid glass bar
that picks the close effect, and the close effect on every window that goes.

- Meta+1 to Meta+4 turn the cube to a workspace.
- Meta+Shift+Q closes the focused window.
- Meta+Return opens `kitty`. The bar's box runs any command.

## Run

Inside a desktop, from a checkout:

```sh
domicile load-shell ./packages/shell-effects-example/src/index.ts
```

Domicile builds it against its own SDK. It needs an engine with patch 0274.

## Test

```sh
bun run test:unit    # the effects' uniforms and limits, the cloth, the cube
bun run test:types
```

`packages/domicile-builder`'s tests build the shell. The SkSL compiles only
in the engine.

## Why it lives in `packages/`

`examples/` is outside the bun workspace, so nothing there runs `bun test`
or `tsc`. The effects are worth testing, so this is a private workspace
package. Copy `src/` into a shell of your own and depend on
`@domicile-desktop/sdk` and `@cprussin/option-result`.
