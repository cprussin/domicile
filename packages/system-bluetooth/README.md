# @domicile-desktop/system-bluetooth

BlueZ for a Domicile shell: each adapter and whether it is powered, the
connected devices, and turning an adapter on or off. Built on
[`@domicile-desktop/sdk/system`](../chrome-sdk/README.md).

## Usage

```ts
import { system } from "@domicile-desktop/sdk/system";
import { setPowered, watchBluetooth } from "@domicile-desktop/system-bluetooth/bluetooth";

const host = system(domicile);
const stop = watchBluetooth(host, (bluetooth) => {
  bluetooth.match({
    Err: () => hide(),
    Ok: ({ adapters, connected }) => show(adapters, connected),
  });
});
await setPowered(host, "/org/bluez/hci0", false);
```

- Reads `GetManagedObjects` once, then again when an object comes or goes or
  an adapter's `Powered` or a device's `Connected` or `Alias` changes.
- An `Err` is a D-Bus failure, such as BlueZ not running or an adapter
  blocked by rfkill.
- A bug or an unexpected reply shape throws, logged to the console.

See [SYSTEM-ACCESS.md](/docs/architecture/SYSTEM-ACCESS.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/system-bluetooth
```

Tests replay D-Bus replies, in the compositor's JSON, through an injected
`System`.
