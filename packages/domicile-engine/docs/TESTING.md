# Testing the engine

## Unit tests

- `domicile_unittests`: everything under `components/domicile/`.
- `ozone_unittests`: the DRM platform.

```sh
autoninja -C out/Domicile domicile_unittests ozone_unittests
./out/Domicile/domicile_unittests
```

- `/scripts/engine-unit-tests.sh` and `/scripts/engine-drm-unit-tests.sh` hold
  the `--gtest_filter` lists and a minimum test count for each.
- A filter that matches nothing exits 0, so the minimum count is what catches a
  missing suite. Add a new suite to the filter and raise the count.

## Everything CI runs

On `crux`, with a built tree:

```sh
nix develop .#full --command ./scripts/check.sh engine
```

This runs the unit tests and every guard, in order, stopping at the first
failure. The guards: [GUARDS.md](GUARDS.md).
