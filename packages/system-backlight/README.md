# @domicile-desktop/system-backlight

Screen brightness for a Domicile shell, on the `files`, `processes` and `dbus`
namespaces of the [`Domicile`](/packages/chrome-sdk/src/desktop/desktop.ts) a
shell is handed. See
[SHELL-SYSTEM-ACCESS.md](/docs/SHELL-SYSTEM-ACCESS.md).

## Usage

```ts
import { brightnessSetter } from "@domicile-desktop/system-backlight/set-brightness";
import { watchBrightness } from "@domicile-desktop/system-backlight/watch-brightness";

const watch = await watchBrightness(domicile, (level) => show(level));
const set = brightnessSetter(domicile);
await set(0.5);
```

- `readBacklight` (`./read-backlight`): the preferred device under
  `/sys/class/backlight`: firmware, then platform, then raw, in systemd's
  order; ties by name. `None` without one.
- `watchBrightness`: the level (0 to 1) now and on each change of a whole
  percent. Re-reads on each `udevadm monitor` uevent and every two minutes.
- `brightnessSetter`: sets a level through logind's
  `org.freedesktop.login1.Session.SetBrightness`. Never sets zero, which turns
  most panels off. Sends one level at a time; a level superseded while waiting
  resolves `SetOutcome.Superseded`.
- `watchAmbientLight` (`./watch-ambient-light`): the room's light in lux, now
  and on each change, from iio-sensor-proxy (`net.hadess.SensorProxy`).
  Claims the sensor until `stop`, and again after a compositor restart. `None`
  without a sensor or without iio-sensor-proxy.
- Every call resolves a `Result<…, SystemError>`. A level that is not a number
  throws.

## Automatic brightness

- `./auto-brightness`: `runAutoBrightness(backlight, light)` follows the
  room's light until stopped, as macOS does. No React. The curve
  (`./auto-brightness-curve`) and the user's learned offset
  (`./learned-offset`, in `localStorage`) are beside it. See the
  [brightness module](../manganese-bar-module-brightness/README.md#automatic-brightness-and-night-light)
  for the rules.
- `./host-ambient-light`: the ambient light sensor as callbacks.
- `./host-backlight` and `./shared-backlight`: the level as callbacks, and
  shared among readers so a level the user chose wins over an automatic one.

## React

`./react`, for a shell on [`@domicile-desktop/react`](../react/README.md):

- `useBacklightLevel()`, `useHasBacklight()`: `undefined` until read.
- `useAutoBrightness(domicile, enabled)`: runs automatic brightness while
  mounted and enabled. Mount it once, on the desktop's page.
- `deskBacklight(domicile)`, `deskBacklightHardware(domicile)`: the shared
  watches, one per desktop.

## Requirements

- `udevadm` on the compositor's `PATH` (systemd).
- A logind session.
- For ambient light, iio-sensor-proxy (`hardware.sensor.iio.enable` on
  NixOS).
- Watching and setting work while the desktop is locked, so a lock screen can
  adjust the brightness ([LOCK.md](/docs/LOCK.md)).

## Testing

`bun run turbo test --filter @domicile-desktop/system-backlight`. Tests answer
the system calls from files recorded on a ThinkPad (`src/fake-system.ts`).
