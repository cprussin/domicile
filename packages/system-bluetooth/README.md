# @domicile-desktop/system-bluetooth

BlueZ for a Domicile shell: each adapter and whether it is powered or
scanning, the devices it knows, and the requests that change them. Built on
[`@domicile-desktop/sdk/system`](../chrome-sdk/README.md).

## Usage

```ts
import { system } from "@domicile-desktop/sdk/system";
import { setPowered, watchBluetooth } from "@domicile-desktop/system-bluetooth/bluetooth";

const host = system(domicile);
const stop = watchBluetooth(host, (bluetooth) => {
  bluetooth.match({
    Err: () => hide(),
    Ok: ({ adapters, devices }) => show(adapters, devices),
  });
});
await setPowered(host, "/org/bluez/hci0", false);
```

- Reads `GetManagedObjects` once, then again when an object comes or goes or
  one of these changes: an adapter's `Powered` or `Discovering`, a device's
  `Alias`, `Name`, `Connected` or `Paired`, or its battery's `Percentage`.
- `devices` holds paired devices and, from a scan, those with a name.
- Requests: `setPowered`, `startDiscovery`, `stopDiscovery`, `connect`,
  `disconnect`, `pair` (then trusts the device) and `forget`.
- `pair` registers no agent, so only devices that need no code pair.
- An `Err` is a D-Bus failure, such as BlueZ not running or an adapter
  blocked by rfkill.
- A bug or an unexpected reply shape throws, logged to the console.
- **Lock:** `watchBluetooth` works while the desktop is locked, so a lock
  screen can show Bluetooth. Every request fails with `locked`
  ([LOCK.md](/docs/LOCK.md)).

See [SHELL-SYSTEM-ACCESS.md](/docs/SHELL-SYSTEM-ACCESS.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/system-bluetooth
```

Tests replay D-Bus replies, in the compositor's JSON, through an injected
`System`.
