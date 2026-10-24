# @domicile-desktop/dev-shell

Runs a shell from this checkout in Domicile and reloads it on every rebuild.

```sh
bun run --filter @domicile-desktop/manganese start:dev
```

- `bin/dev-shell.sh <shell>` starts the engine the flake pins, and the
  compositor and runner built from this checkout. Each shell's `start:dev`
  runs it.
- `bin/dev-shell-reload.sh` hands each vite build to the running desktop with
  `domicile load-shell`. Windows survive a reload.

## Test

```sh
bun run turbo test:shell --filter=@domicile-desktop/dev-shell
```
