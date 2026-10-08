# @domicile-desktop/system-network

The network for a Domicile shell, from NetworkManager, iwd or wpa_supplicant:
connectivity and the primary connection, with the Wi-Fi network's name and
signal. The Wi-Fi device, from NetworkManager or iwd: its networks and
connection, and the requests that change them. Built on
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

## Wi-Fi

```ts
import { connectWifi, watchWifi } from "@domicile-desktop/system-network/wifi";

const stop = watchWifi(host, (wifi) => {
  wifi.match({
    Err: () => hide(),
    Ok: (found) => found.match({ None: () => hide(), Some: (device) => show(device) }),
  });
});
await connectWifi(host, device, network, "passphrase");
```

- `watchWifi` watches the first Wi-Fi device of NetworkManager, else iwd, by
  `NameHasOwner`. `None` is no device, or neither service. wpa_supplicant is
  not controlled.
- Requests: `setWifiEnabled`, `scanWifi`, `connectWifi`, `disconnectWifi`.
  Each resolves `Ok` once the service accepts it; the watch reports the
  outcome.
- `connectWifi` uses a network's saved profile when it has one. A new secured
  network needs a passphrase:
  - NetworkManager: a new WPA-PSK profile, saved.
  - iwd: `iwctl --passphrase … station <interface> connect <ssid>`, since iwd
    asks an agent for it and a page cannot serve one. `iwctl` must be on the
    compositor's `PATH`.
- NetworkManager reads re-run on each property change of an object read, an
  access point coming or going, or a device coming or going. It does not say
  when a scan runs, so `scanning` is always `false`.
- iwd does not report addresses, so `connection.ip` is `undefined`.

See [SHELL-SYSTEM-ACCESS.md](/docs/SHELL-SYSTEM-ACCESS.md).

## Test

```sh
bun run turbo test --filter @domicile-desktop/system-network
```

Tests replay D-Bus replies, in the compositor's JSON, through an injected
`System`.
