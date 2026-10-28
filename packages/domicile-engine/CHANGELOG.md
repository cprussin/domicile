# @domicile-desktop/engine

## 0.1.0

### Minor Changes

- f3156a1: Emulated input (remote desktop, input sharing) on a desktop on a TTY now reaches the shell and the lock screen, as on a headless desktop. A headless desktop's monitors draw at their own scale, and emulated pointers land where they point on a scaled or rotated monitor.
- 40f5af3: The engine casts the desktop to Google Cast TVs: `domicile.googleCast` lists them, and casts to them and stops. `engineCast(domicile.googleCast)` in `@domicile-desktop/sdk/cast` is its backend, and the `Cast` bar item uses it, so it shows when a TV is near.
- ab2d2f0: The engine hands `Shell` the typed `Domicile` and an app's `main` the `AppDomicile`, built by the SDK's layer, which the engine bundles. Shells and apps no longer call `desktop()`/`appDesktop()`. The SDK drops `system()`, the portal watch helpers and `./appearance` from its public API; use the `Domicile` namespaces.
- 5955f66: On a headless desktop, input from a remote desktop app (EIS) reaches the shell and its lock screen, so the desktop can be driven and unlocked with no keyboard or mouse attached. Screen casts of a headless desktop now show the pointer.
- 401b0b4: `OZONE=headless` runs a full desktop with no display device or seat, such as on WSL2. Its monitors are virtual ones the shell adds, and screen casts show each one. Apps draw in shared memory, GL apps included.
- fccc784: Automatic brightness and a night light, as on macOS. The backlight follows the room's light from iio-sensor-proxy and learns from the levels the user sets. The night light warms every monitor from sunset to sunrise in the time zone's city, or on custom hours, with a switch in the brightness popover. Both are on by default and set in the Settings app's Shell page or under `shell_options`. Shells set the color temperature with `domicile.displays.setColorTemperature(kelvin)`.
- ca86667: A shell can add a monitor with no connector, which the desk extends onto and only a capture shows, with `system(domicile).addVirtualMonitor()`. Casting to a TV extends the desk this way.

### Patch Changes

- c7af3d5: Each Google Cast asks the shell what to show, so Extend and Cast… work after an earlier cast; before, the engine silently recast its first pick. A cast to a TV of another shape is letterboxed in black, not green.
- 17064a7: A browser window whose `<webview>` moves in the shell's document shows its page again where it lands. Before, the page stayed detached and the window froze, which happened when a window crossed monitors while being resized.
- a88ce23: The engine is a workspace package: its shell tests run in `test:shell`, and its checks against a built tree in `test:engine`.
- 7b48b3b: A page in a browser window is told the monitor it is on as its `screen`, not the box around every monitor. A fullscreen video that sizes itself to the screen is letterboxed instead of cropped.
- 901b871: The keystroke latency run divides by the display frame viz reports, not an assumed 60 Hz, and also reports `commit to present` from viz's presentation feedback. Its guard allows `commit to pixel` the probe's floor plus one frame, so a 120 Hz panel passes.
- b85d9bb: Name what keeps the screens on. A new `idle_holds` system call (`session.idleHolds()` in the SDK) lists the windows and applications holding idle inhibitors, and the bar's eye opens and names them. The compositor logs each change, and the input that restarts the idle clock when it was getting close to blanking or locking, naming the event and device for the browser's own input.
- b1041f8: The last package-specific scripts leave `scripts/`: `dev-shell` becomes a package the shells' `start:dev` runs, docs media capture moves into the site, `update-engine-release.sh` and the IDL check into the engine, and `smoke-compositor.sh` into the e2e harness.
