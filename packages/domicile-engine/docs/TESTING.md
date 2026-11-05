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
- `InputSettingsTest`, `DrmInputControllerTest`, `TypingGuardTest` and
  `ScrollAcceleratorTest` cover input parsing, retained settings, typing policy
  and scroll scaling. `FrameSinkBrokerTest` covers the input configuration
  message crossing Mojo.
- `LibInputKeyboardPathTest` feeds native keycodes through evdev filtering,
  duplicate suppression and release handling. `test-libinput-devices-share-a-seat.sh`
  guards the shared seat and descriptor cancellation route. Real keyboard
  pairing, physical clicks during typing and suppressed contact lifetimes
  require the DRM input checks in a disposable VM or on hardware.
- `DrmInputOpensTest` uses deferred logind replies and real descriptors to
  cover per-device serialization, canceled claims, queued replacements,
  release failures, delayed release echoes, native retries and stale resume
  names.
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
