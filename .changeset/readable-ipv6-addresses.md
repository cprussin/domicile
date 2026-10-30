---
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-bar-module-network": minor
"@domicile-desktop/system-network": minor
---

Make IPv6 addresses in the network panel easier to read.

- `system-network`: `Addressing` splits `addresses` into `ipv4` and `ipv6`, and leaves out temporary IPv6 addresses.
- `component-library`: `DetailList` takes an `address` option that wraps a value only between its colon-separated groups and grays its prefix length.
- `manganese-bar-module-network`: the details show IPv4 and IPv6 addresses on their own rows, as addresses.
