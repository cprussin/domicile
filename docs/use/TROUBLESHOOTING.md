# Troubleshooting

## The desktop won't start

- Log in on a console (Ctrl+Alt+F2) and run `domicile` there. It prints
  which config it used, and why it stops.
- Check your config: `domicile check-config ~/.config/domicile/domicile.json`.
- On Ubuntu 24.04+, the package's AppArmor profile must be loaded for the
  browser engine to start. Reinstall the package if it is missing.

## The screen won't unlock

The system's `domicile` login service is missing. See
[If it won't unlock](LOCK-AND-IDLE.md#if-it-wont-unlock).

## It stutters while the machine is busy

Domicile asks rtkit to give its drawing work priority. rtkit comes with most
desktops that use PipeWire. If it still stutters:

- Make sure rtkit is installed.
- Join the `domicile` group and log in again:
  `sudo usermod -aG domicile "$USER"`. On NixOS, add
  `users.users.<you>.extraGroups = ["domicile"]` to your system configuration.

## No battery, sound or network in the bar

- **Battery** needs UPower.
- **Sound** needs PipeWire or PulseAudio, and `pactl`.
- **Network** needs NetworkManager, iwd or wpa_supplicant.

The packages recommend these; on NixOS the module turns on UPower.

## The screen stays on

Something is keeping it awake: a playing video, the eye in the
[top bar](TOP-BAR.md), or a cast. See [IDLE.md](../IDLE.md#finding-what-keeps-a-desktop-awake).

## The touchpad ignores me while I type

That stops a palm moving the pointer. For games, turn it off until the
desktop restarts: `domicile disable-while-typing off`.

## Graphics problems

See [GPU and display issues](../TTY-DEBUGGING.md): how to get your old desktop
back, find where it fails, and report it.

## Still stuck

[Open an issue](https://github.com/cprussin/domicile/issues) with what you
saw, your distribution and your graphics card.
