# Host readouts

How the backlight and audio that the [top bar](TOP-BAR.md) shows are read.
The page reads both itself through libraries, as it does the battery; see
[TOP-BAR.md](TOP-BAR.md#battery).

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
- **Meters**: one `parec` per metered device or stream, only while the mixer
  shows it. They stop when the mixer closes or the page goes away.
- `pactl` and `parec` come from the compositor's `PATH`. The flake's wrapper
  adds PulseAudio's.
