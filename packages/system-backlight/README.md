# @domicile-desktop/system-backlight

Screen brightness for a Domicile shell, on the system calls of
[`@domicile-desktop/sdk/system`](/packages/chrome-sdk/src/system.ts). See
[SHELL-SYSTEM-ACCESS.md](/docs/SHELL-SYSTEM-ACCESS.md).

## Usage

```ts
import { system } from "@domicile-desktop/sdk/system";
import { brightnessSetter } from "@domicile-desktop/system-backlight/set-brightness";
import { watchBrightness } from "@domicile-desktop/system-backlight/watch-brightness";

const host = system(domicile);
const watch = await watchBrightness(host, (level) => show(level));
const set = brightnessSetter(host);
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
- Every call resolves a `Result<…, SystemError>`. A level that is not a number
  throws.

## Requirements

- `udevadm` on the compositor's `PATH` (systemd).
- A logind session.
- Watching and setting work while the desktop is locked, so a lock screen can
  adjust the brightness ([LOCK.md](/docs/LOCK.md)).

## Testing

`bun run turbo test --filter @domicile-desktop/system-backlight`. Tests answer
the system calls from files recorded on a ThinkPad (`src/fake-system.ts`).
