# @domicile-desktop/system-network

NetworkManager for a Domicile shell: connectivity and the primary connection,
with the Wi-Fi network's name and signal. Built on
[`@domicile-desktop/sdk/system`](../chrome-sdk/README.md).

## Usage

```ts
import { system } from "@domicile-desktop/sdk/system";
import { watchNetwork } from "@domicile-desktop/system-network/network";

const stop = watchNetwork(system(domicile), (network) => {
  network.match({
    Err: () => hide(),
    Ok: ({ connectivity, link }) => show(connectivity, link),
  });
});
```

- Reports the network once, then after each change NetworkManager signals
  (`PropertiesChanged`) on the objects it read: the manager, the primary
  connection and its access point.
- `link` is `None`, `Wired`, `Wifi` (SSID and strength, 0 through 1) or
  `Other` (VPNs and the rest), by NetworkManager's connection type.
- An `Err` is a D-Bus failure, such as NetworkManager not running.
- A bug or an unexpected reply shape throws, logged to the console.

See [SHELL-SYSTEM-ACCESS.md](/docs/SHELL-SYSTEM-ACCESS.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/system-network
```

Tests replay D-Bus replies, in the compositor's JSON, through an injected
`System`.
