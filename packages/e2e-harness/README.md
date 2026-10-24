# @domicile-desktop/e2e-harness

The end-to-end checks: scripts that run the real compositor or `domicile`
binary, a headless mock chrome for the chrome protocol, and a check on how the
scripts report failures.

| Module | What it does |
|---|---|
| `src/mock-chrome.ts` | Connects to the chrome socket, handshakes, and prints every message the host sends. |
| `src/chrome-socket.ts` | Shared socket client: newline-delimited JSON framing (`src/newline-frames.ts`), the handshake, and decoding with `src/protocol.ts`'s schemas. |
| `src/protocol.ts`, `src/chrome-message.ts`, `src/newline-frames.ts`, `src/host-stream.ts` | The compositor's JSON wire in TypeScript. Changes with `packages/domicile-protocol`. |
| `tests/*.sh` | The end-to-end checks, run by `test:e2e`. |
| `lib/harness.sh`, `lib/test-client.sh` | Sourced by the checks: the compositor-liveness bail and the Wayland test client build. |
| `src/verdicts.ts` | Checks that shell checks report failures through `lib/harness.sh`. See [Script verdicts](docs/SCRIPT-VERDICTS.md). |

## Mock chrome

The mock chrome speaks the engine's chrome protocol without a display, so the
message plane can be tested in CI.

```sh
DOMICILE_CHROME_SOCK=/tmp/domicile-rt/domicile-chrome.sock \
  bun packages/e2e-harness/src/mock-chrome.ts
```

- `DOMICILE_CHROME_SOCK`: chrome socket path. Required.
- `DOMICILE_CHROME_LISTEN_MS`: how long to listen. Default 6000. The process
  exits on its own after this, so it can run unattended.
- `DOMICILE_CHROME_DPR`: device pixel ratio to report. Unset sends none.

## Test

```sh
bun run turbo test --filter @domicile-desktop/e2e-harness      # unit tests
nix develop .#full -c bun run turbo test:e2e \
  --filter @domicile-desktop/e2e-harness                        # end to end
```

- Unit tests cover the pure parts. `test:e2e` covers socket behavior against
  a live compositor. It needs cargo, the Wayland client tools and PipeWire, so
  it is not part of `test`. `e2e.yml` runs it through `scripts/check.sh e2e`.
- `test:e2e` is never cached: it builds and runs binaries outside turbo's
  view.
- `verdicts.test.ts` reads `scripts/` and every package's `tests/` from disk
  and runs `bash` against `lib/harness.sh`. It runs in `test:unit`. The root
  `turbo.json` lists those as inputs so it re-runs when they change.
