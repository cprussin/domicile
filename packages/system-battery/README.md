# @domicile-desktop/system-battery

The battery for a Domicile shell, from UPower over the system bus.

- Reads UPower's DisplayDevice: the combined charge of every battery and
  whether a charger is connected.
- Built on [`@domicile-desktop/sdk/system`](../chrome-sdk/README.md)'s
  `dbusCall` and `dbusMatch`. See
  [SYSTEM-ACCESS.md](/docs/architecture/SYSTEM-ACCESS.md).
- Needs `upower` running. Without it, calls fail with a `Dbus` error.

## Usage

```ts
import { system } from "@domicile-desktop/sdk/system";
import { watchBattery } from "@domicile-desktop/system-battery/battery";

const watched = await watchBattery(system(domicile));
watched.match({
  Err: (error) => console.error(error.message),
  Ok: async ({ items }) => {
    for await (const battery of items) {
      // `None()` without a battery; else `Some({ charge, charging })`.
    }
  },
});
```

- `readBattery(system)`: the reading now, `Result<Option<Battery>, SystemError>`.
- `watchBattery(system)`: the reading now as the first item, then one per
  UPower change. `stop()` ends it.
- `charge` is 0 through 1. `charging` is true unless the battery is draining
  (discharging, empty or pending discharge), so a full battery on AC counts.
- **Lock:** D-Bus calls fail with `Locked` while the desktop is locked, so
  both fail to start then. A watch started before the lock keeps reporting.

## Dependencies

- `@domicile-desktop/sdk` for the system calls, `zod` to parse UPower's
  replies, `@cprussin/option-result` for `Result` and `Option`.

## Test

```sh
bun run turbo test --filter @domicile-desktop/system-battery
```

Tests answer with recorded UPower replies through a fake `System`.
