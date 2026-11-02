# @domicile-desktop/rust-checks

The cargo workspace's required checks. See
[RUST.md](/docs/guidelines/RUST.md) for what they enforce.

## Test

```sh
bun run turbo test:rust --filter=@domicile-desktop/rust-checks
```

| Task | Checks | Needs | Run by |
|---|---|---|---|
| `test:rust` | `tests/rust-*.sh`: `cargo fmt`, `cargo clippy -D warnings`, `cargo test` | cargo, libxkbcommon | `bun run check`, `cargo-test.yml` |
| `test:shell` | `tests/test-*.sh`: `lib/rust-check.sh` | bun | `turbo test` |

- `test:rust` is never cached: cargo has its own.
- `lib/rust-check.sh` skips `cargo test` when the workspace cannot link.
- Each check is run by [`check-runner`](../check-runner/README.md).
