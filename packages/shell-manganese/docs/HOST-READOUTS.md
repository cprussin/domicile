# Host readouts

How the compositor reads the backlight and audio that the
[top bar](TOP-BAR.md) shows. The compositor pushes changes to the page. The
battery comes from a library instead; see [TOP-BAR.md](TOP-BAR.md#battery).

## Brightness

- Reads `/sys/class/backlight` (`domicile_host::backlight`). It picks
  firmware, then platform, then raw devices, in systemd's order.
- Re-reads on uevents and pushes changes of a whole percent.
- Sets the level through logind's `Session.SetBrightness`, never to zero.

## Volume

- Runs `pactl subscribe` and re-reads `pactl -f json info` and `list` on
  changes (`domicile_host::audio`).
- `DOMICILE_PACTL` names the `pactl` binary. The flake's wrapper sets it.
- **Meters**: the mixer renews each meter every second. The compositor runs
  one `parec` per meter (`DOMICILE_PAREC` names the binary) and stops it when
  it is not renewed.
