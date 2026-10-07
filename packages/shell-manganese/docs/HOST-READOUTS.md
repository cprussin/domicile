# Host readouts

How the backlight and audio that the [top bar](TOP-BAR.md) shows are read.
The page reads both itself through libraries, as it does the battery; see
[TOP-BAR.md](TOP-BAR.md#battery).

## One watch per desk

- `src/readouts/readouts.ts` holds the battery, backlight, sound, network and
  Bluetooth watches. `Desktop` makes it once for the page; every bar and the
  lock screen read from it.
- Each is a `sharedWatch` (`src/readouts/shared-watch.ts`): the first reader
  starts the library's watch, the last one stops it, and a late reader gets
  the current value. Components read it with `useSharedWatch`.
- So a desk runs one `pactl subscribe`, one `udevadm monitor` and one D-Bus
  match each for UPower, the network service and BlueZ, whatever the monitor
  count.
  On a tty and nested alike the shell is one page; see
  [ONE-PAGE-FOR-THE-DESK.md](/docs/architecture/ONE-PAGE-FOR-THE-DESK.md).
- Failures are handled inside each watch as before: logged, or passed on as
  an `Err` the item hides on.
- The launcher's installed applications are read once per page already
  (`appSearch` in `Desktop`).

## Brightness

- Read, watched and set by
  [`@domicile-desktop/system-backlight`](/packages/system-backlight/README.md)
  on the shell's system calls, which has the rules.
- `src/brightness/host-backlight.ts` wires it to the bar and logs failures to
  the console.

## Volume

- `@domicile-desktop/system-audio` runs `pactl` and `parec` through
  `@domicile-desktop/sdk/system`. See its
  [README](/packages/system-audio/README.md).
- Holds `pactl -f json subscribe` open and rereads `pactl -f json info` and
  `list` once a burst of changes settles.
- **Meters**: one `parec` per metered device or stream, only while a mixer
  shows it. Mixers on several bars share it (`src/volume/shared-meters.ts`).
  It stops when the last mixer showing it closes or the page goes away.
- `pactl` and `parec` come from the compositor's `PATH`. The flake's wrapper
  adds PulseAudio's.
