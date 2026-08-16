# @domicile/e2e-harness

Headless chrome stand-ins for the end-to-end scripts in `/scripts`. The real
chrome is the Electron app in [`apps/shell`](../../apps/shell/README.md); these
speak the same protocol over the same socket without needing a display, so the
message plane can be verified in CI and on a headless box.

| Entry | Used by | What it does |
|---|---|---|
| `src/mock-chrome.ts` | `scripts/e2e-chrome.sh`, `scripts/e2e-spawn.sh` | Connects, handshakes, and prints every frame the host pushes so the calling script can grep for one. |
| `src/input-injector.ts` | `scripts/e2e-input.sh` | Waits for `app_appeared`, then forwards a focus + pointer + keyboard sequence to prove input injection reaches a real client. |

`src/chrome-socket.ts` is the shared connection: newline-delimited JSON framing
from [`@domicile/chrome-sdk/newline-frames`](../chrome-sdk/README.md), the
handshake, and decoding via the SDK's protocol schemas — so the harnesses drift
from the wire format only if the SDK does.

Both harnesses read the socket path from `DOMICILE_CHROME_SOCK` and exit on
their own timer, since the scripts that spawn them run unattended.

## Usage

```sh
DOMICILE_CHROME_SOCK=/tmp/domicile-rt/domicile-chrome.sock \
  bun packages/e2e-harness/src/mock-chrome.ts
```

## Test

```sh
bun run --filter @domicile/e2e-harness test
```

Only the pure parts are unit tested; the socket behaviour is covered by the e2e
scripts themselves against a live compositor.
