# @domicile-desktop/system-network

The network for a Domicile shell, from NetworkManager, iwd or wpa_supplicant:
connectivity and the primary connection, with the Wi-Fi network's name and
signal. Built on [`@domicile-desktop/sdk/system`](../chrome-sdk/README.md).

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

- `watchNetwork` watches the first service on the system bus, by
  `NameHasOwner`: NetworkManager, then iwd, then wpa_supplicant. With none, it
  watches NetworkManager. It does not switch if another starts later.
- To force one, call its watch, which takes the same arguments:

| Export | Service | Reads |
|---|---|---|
| `networkmanager` `watchNetworkManager` | `org.freedesktop.NetworkManager` | connectivity; `link` is `None`, `Wired`, `Wifi` or `Other` (VPNs and the rest) |
| `iwd` `watchIwd` | `net.connman.iwd` | the connected station's network; signal from `GetOrderedNetworks` |
| `wpa-supplicant` `watchWpaSupplicant` | `fi.w1.wpa_supplicant1` (only with `-u`) | the current BSS of an interface that is `completed` or rekeying (`group_handshake`) |

- iwd and wpa_supplicant know only Wi-Fi: `connectivity` is always `Unknown`,
  and `link` is `Wifi` or `None`, even with a cable plugged in.
- `strength` is 0 through 1. Both grade dBm as NetworkManager does: -100 dBm
  is 0, -40 dBm is 1. iwd's signal changes after each scan.
- Reports once, then after each change the service signals.
- An `Err` is a D-Bus failure, such as the service not running.
- A bug or an unexpected reply shape throws, logged to the console.

See [SHELL-SYSTEM-ACCESS.md](/docs/SHELL-SYSTEM-ACCESS.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/system-network
```

Tests replay D-Bus replies, in the compositor's JSON, through an injected
`System`.
