# Host readouts

How the backlight and audio that the [top bar](TOP-BAR.md) shows are read.
The compositor pushes backlight changes to the page; the page reads audio
itself. The battery comes from a library too; see
[TOP-BAR.md](TOP-BAR.md#battery).

## Brightness

- Reads `/sys/class/backlight` (`domicile_host::backlight`). It picks
  firmware, then platform, then raw devices, in systemd's order.
- Re-reads on uevents and pushes changes of a whole percent.
- Sets the level through logind's `Session.SetBrightness`, never to zero.

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
