# @domicile-desktop/ci

Tests of the CI: the workflows under `.github/workflows` and the scripts under
`.github/scripts` they call.

## Test

```sh
bun run turbo test:shell --filter=@domicile-desktop/ci
```

- Each `tests/*.sh` is one check, run by
  [`check-runner`](../check-runner/README.md).
- None needs a Chromium tree, `crux` or the network.
