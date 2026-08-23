# @domicile/e2e-harness

Headless chrome stand-ins for the scripts in `/scripts` — the `e2e-*.sh`
checks, the `measure*.sh` benchmarks, and `probe-transparency.sh`. The real
chrome is the Electron app in [`apps/shell`](../../apps/shell/README.md); these
speak the same protocol over the same socket without needing a display, so the
message plane can be verified in CI and on a headless box.

| Entry | Used by | What it does |
|---|---|---|
| `src/mock-chrome.ts` | `e2e-chrome.sh`, `e2e-dmabuf.sh`, `e2e-hidpi.sh` | Connects, handshakes, and prints every frame the host pushes so the calling script can grep for one. |
| `src/input-injector.ts` | `e2e-input.sh` | Waits for `app_appeared`, then forwards a focus + pointer + keyboard sequence to prove input injection reaches a real client. |
| `src/reload-typist.ts` | `e2e-stuck-key.sh` | Holds a key down, reloads, and then tries to toggle it — the page dying mid-press, which used to leave that key down in the seat for good. |
| `src/close-probe.ts` | `e2e-close.sh` | Asks the first client that appears to close its window — what the X on a native window's tab does — and prints what the host says next. |
| `src/focus-probe.ts` | `e2e-chrome-layer.sh` | Focuses the first app announced and stays connected, so the check can watch the keyboard come back to the chrome on its own when that client goes away. |
| `src/two-chrome-probe.ts` | `e2e-two-chromes.sh` | Reports what *two* connected chromes are told about focus, since a change is announced once and a page that missed it has missed it for good. |
| `src/spawn-probe.ts` | `e2e-spawn.sh` | Asks the compositor to spawn a client that reports the display it was handed, proving `spawn` aims what it launches at Domicile rather than the host desktop. |
| `src/stuck-chrome.ts` | `e2e-slow-chrome.sh` | Connects, handshakes, and then never reads again — a wedged chrome, which the compositor has to survive without stalling its other clients. |
| `src/alpha-probe.ts` | `probe-transparency.sh` | Reports whether the frames an app commits carry real transparency, which is the assumption hole-punching rests on. |
| `src/straight-alpha-probe.ts` | `e2e-window-alpha.sh` | Reports whether frames reaching a chrome carry *straight* alpha, i.e. that the compositor divided out what the client premultiplied. |
| `src/keystroke-driver.ts` | `measure.sh` | Types over the host socket at a steady rate, so the latency numbers are measured against a known count of keystrokes. |
| `src/chrome-typist.ts` | `measure-round-trip.sh` | Types with real input events into the chrome's own window instead, which is what puts the chrome's own clock back in the measured loop. |

`src/chrome-socket.ts` is the shared connection: newline-delimited JSON framing
from [`@domicile/chrome-sdk/newline-frames`](../chrome-sdk/README.md), the
handshake, and decoding via the SDK's protocol schemas — so the harnesses drift
from the wire format only if the SDK does.

All of them but `chrome-typist.ts` read the socket path from
`DOMICILE_CHROME_SOCK`; that one drives Electron's debugger instead, because
its whole point is to deliver real input events to the chrome's own window
rather than to speak the protocol. Each ends on its own — on a timer, or when
its sequence is done — since the scripts that spawn them run unattended.

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
