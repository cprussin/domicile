# vanilla-shell

The shell from [SHELL-QUICKSTART.md](/docs/SHELL-QUICKSTART.md), in plain
JavaScript:

- Every window side by side, the focused one outlined.
- A box at the bottom that runs the command typed in it, such as `firefox`.
- Meta+Enter opens `kitty`.

`shell.js` is the whole shell. [`react-shell`](/examples/react-shell) is the
same shell in React.

```sh
domicile ./shell.js
```

It imports nothing, so Domicile runs it as it is.
