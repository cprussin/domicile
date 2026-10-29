# react-shell

The shell from [SHELL-QUICKSTART.md](/docs/SHELL-QUICKSTART.md), in React:

- Every window side by side, the focused one outlined.
- A box at the bottom that runs the command typed in it, such as `firefox`.
- Meta+Enter opens `kitty`.

`shell.tsx` is the whole shell.

```sh
domicile ./shell.tsx
```

Domicile builds it, with `@domicile-desktop/*` and React from its own install,
so it needs no project. `packages/domicile-builder`'s tests build it.

[`vanilla-shell`](/examples/vanilla-shell) is the same shell in plain
JavaScript.
