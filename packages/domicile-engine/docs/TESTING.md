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
- `InputSettingsTest`, `DrmInputControllerTest`, `TypingGuardTest`,
  `ScrollAcceleratorTest` and `FlingTrackerTest` cover input parsing, retained
  settings, typing policy, scroll scaling and a flick's speed. `FrameSinkBrokerTest` covers the input configuration
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
- `WaylandPointerGesturesTest` covers cumulative pinch scale and hold canceling
  a fling after the native axis-stop frame.
- A filter that matches nothing exits 0, so the minimum count is what catches a
  missing suite. Add a new suite to the filter and raise the count.

## Native Chrome gestures

`scripts/guard-native-chrome-gestures.py` tests a native Google Chrome `--app`
window through two private compositors and the engine. It requires an installed
Google Chrome and a built compositor. Run it with the engine's runtime libraries:

```sh
python3 packages/domicile-engine/scripts/guard-native-chrome-gestures.py \
  --compositor "$PWD/target/debug/domicile-compositor" \
  --chrome /path/to/google-chrome-stable \
  --engine /path/to/chromium/src/out/Official \
  --require-official --out /tmp/native-chrome-gesture-receipt
```

The output directory must be new. The test creates empty profiles and private
runtime directories, then records page scale, history changes, process exits and
crash dumps. It checks pinch zoom, cancellation when an `<app>` is removed during
dispatch, a new pinch after removal, horizontal history navigation and vertical
scrolling without navigation. `--history-only` isolates the existing finger-scroll
behavior. Omitting `--engine` tests the compositor and native client directly.

The input is native Wayland pinch and finger-axis events from the outer
compositor. CDP reads the resulting page state; it does not inject gestures.
This test covers nested Wayland acquisition and forwarding. Physical libinput
recognition, device pairing and reconnect require the DRM hardware checks.

`PinchMetadataTest` covers scale and rotation through Aura copies and Mojo,
cancellation, wheel coalescing and consumed ownership through target removal.
`ControlChannelTest` covers the typed pinch
messages, including unsigned timestamps above `INT32_MAX`. These run in
`domicile_unittests` without requiring Google Chrome.

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
