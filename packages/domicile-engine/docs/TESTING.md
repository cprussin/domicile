# Testing the engine

## Unit tests

- `domicile_unittests`: everything under `components/domicile/`.
- `ozone_unittests`: the DRM platform, and the Wayland keyboard before a
  keymap.

```sh
autoninja -C out/Domicile domicile_unittests ozone_unittests
./out/Domicile/domicile_unittests
```

- `scripts/unit-tests.sh` and `scripts/drm-unit-tests.sh` hold the
  `--gtest_filter` lists and a minimum test count for each.
- A filter that matches nothing exits 0, so the minimum count is what catches a
  missing suite. Add a new suite to the filter and raise the count.

## Everything CI runs

On `crux`, with a built tree:

```sh
nix develop .#full --command bun run turbo run test:engine --filter=@domicile-desktop/engine
```

This is `scripts/run-checks.sh`: the unit tests and every guard, in order,
stopping at the first failure. `run-checks.sh <check>` runs one, such as
`guard-client-window`. The guards: [GUARDS.md](GUARDS.md).

- The headless guards run together, half the cores' worth at a time
  (`DOMICILE_ENGINE_CHECKS_AT_ONCE`). `crux` runs two engine jobs, and more
  at once starve the browsers past their guards' deadlines.

The package's `tests/` hold the shell tests of the guards, their helpers and
the patch series. They need no tree and run in `test:shell`, on every pull
request.
