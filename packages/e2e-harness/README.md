# @domicile-desktop/e2e-harness

A headless mock chrome for testing the chrome protocol, plus checks on how
`scripts/*.sh` report failures and skips.

| Module | What it does |
|---|---|
| `src/mock-chrome.ts` | Connects to the chrome socket, handshakes, and prints every message the host sends. |
| `src/chrome-socket.ts` | Shared socket client: newline-delimited JSON framing (`src/newline-frames.ts`), the handshake, and decoding with `src/protocol.ts`'s schemas. |
| `src/protocol.ts`, `src/chrome-message.ts`, `src/newline-frames.ts`, `src/host-stream.ts` | The compositor's JSON wire in TypeScript. Changes with `packages/domicile-protocol`. |
| `src/verdicts.ts` | Checks that `scripts/*.sh` report failures through `scripts/lib/harness.sh`. See [Script verdicts](docs/SCRIPT-VERDICTS.md). |
| `src/skips.ts` | Checks that a script exiting 77 prints `SKIP: <reason>`, the format `check.sh` reads. Without it, `DOMICILE_CHECK_STRICT=1` fails the skip. |

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
bun run turbo test --filter @domicile-desktop/e2e-harness
```

- Unit tests cover the pure parts. The e2e scripts cover socket behavior
  against a live compositor.
- `verdicts.test.ts` and `skips.test.ts` read `scripts/` from disk, and
  `verdicts.test.ts` runs `bash` against `scripts/lib/harness.sh`. They run in
  `test:unit`. `turbo.json` lists `scripts/**` as an input so they re-run when
  scripts change.
