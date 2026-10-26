# Host readouts

How the backlight and audio that the [top bar](TOP-BAR.md) shows are read.
The page reads both itself through libraries, as it does the battery; see
[TOP-BAR.md](TOP-BAR.md#battery).

## One watch per desk

- The battery, backlight, sound, network and Bluetooth watches are made once
  per desktop (`perDesktop`, `@domicile-desktop/react/per-desktop`):
  `deskBattery`, `deskSound`, `deskNetwork` and `deskBluetooth` in their
  `system-*` package's `/react`, `deskBacklight` among them.
  Every bar and the lock screen read the same ones.
- Each is a `sharedWatch` (`@domicile-desktop/react/shared-watch`): the first
  reader starts the library's watch, the last one stops it, and a late reader
  gets the current value. Components read it with `useSharedWatch`
  (`@domicile-desktop/react/use-shared-watch`).
- The desktop also holds the sound and backlight watches for the volume and
  brightness keys (`useVolumeKeys`, `useBrightnessKeys`), so those two run
  whether or not a bar shows them.
- So a desk runs one `pactl subscribe`, one `udevadm monitor` and one D-Bus
  match each for UPower, the network service and BlueZ, whatever the monitor
  count.
  On a tty and nested alike the shell is one page; see
  [ONE-PAGE-FOR-THE-DESK.md](/docs/architecture/ONE-PAGE-FOR-THE-DESK.md).
- Failures are handled inside each watch: logged, or passed on as an `Err`;
  see each item in [TOP-BAR.md](TOP-BAR.md).
- The launcher's installed applications are read once per page already
  (`appSearch` in `Desktop`).

## Brightness

- Read, watched and set by
  [`@domicile-desktop/system-backlight`](/packages/system-backlight/README.md)
  on the shell's system calls, which has the rules.
- `system-backlight/src/host-backlight.ts` wires it to the bar and logs failures to
  the console.
- Automatic brightness reads iio-sensor-proxy's ambient light through the same
  library (`watchAmbientLight`), only while the desktop runs it
  (`useAutoBrightness`). See the
  [module's README](/packages/manganese-bar-module-brightness/README.md).

## Volume

- `@domicile-desktop/system-audio` runs `pactl` and `parec` through
  `domicile.processes`. See its
  [README](/packages/system-audio/README.md).
- Holds `pactl -f json subscribe` open and rereads `pactl -f json info` and
  `list` once a burst of changes settles.
- **Meters**: one `parec` per metered device or stream, only while a mixer
  shows it. Mixers on several bars share it (`system-audio/src/shared-meters.ts`).
  It stops when the last mixer showing it closes or the page goes away.
- `pactl` and `parec` come from the compositor's `PATH`. The flake's wrapper
  adds PulseAudio's.
