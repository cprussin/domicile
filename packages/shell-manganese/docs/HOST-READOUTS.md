# Host readouts

How the compositor reads the battery, backlight and audio that the
[top bar](TOP-BAR.md) shows. The compositor pushes changes to the page.

## Battery

- Reads `/sys/class/power_supply` and sums all batteries
  (`domicile_host::battery`, tested in
  `packages/domicile-host/tests/battery.rs`).
- Counts USB-C chargers as AC.
- Re-reads on the kernel's `NETLINK_KOBJECT_UEVENT` messages, with a slow poll
  as backup.
- Pushes a reading on each whole-percent or AC change, and once to a newly
  connected page.
- It doesn't use `navigator.getBattery`. That API needs UPower over D-Bus,
  which a tty desktop lacks, so it always reports "charging, 100%".

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
