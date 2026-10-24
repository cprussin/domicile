# @domicile-desktop/check-runner

Runs a package's shell checks and reports each as passed, failed or skipped.

```sh
check-runner tests/*.sh
```

A package hooks its checks into turbo with a `test:shell` script, which the
root `test` task runs:

```json
"scripts": { "test:shell": "check-runner tests/*.sh" }
```

## Verdicts

A check exits:

- `0` to pass. Its `PASS:` lines are printed under its `ok`.
- `77` when it cannot run here. It must print `SKIP: <reason>`; a skip with no
  reason fails.
- Anything else to fail. Its log's tail goes in the summary and the whole log
  is kept under `$DOMICILE_CHECK_LOG_DIR/domicile-check-logs/`.

A run that checked nothing fails.

| Variable | Effect |
|---|---|
| `DOMICILE_CHECK_STRICT=1` | A skip fails. CI sets it. |
| `DOMICILE_CHECK_ALLOW_SKIP` | Checks, space separated, that may still skip under `STRICT`. |
| `DOMICILE_CHECK_LOG_DIR` | Where failing logs are kept. Defaults to `$TMPDIR`. |

## Layout

| Path | What it is |
|---|---|
| `bin/check-runner.sh` | Runs its arguments one at a time. |
| `src/report.sh` | The verdicts and tally, sourced by runners that order their own checks (`scripts/check.sh`). |
| `src/skips.ts` | Scans every check's `exit 77` for a `SKIP:` line, covering skips a run never reaches. |

## Test

```sh
bun run turbo test --filter @domicile-desktop/check-runner
```
